package dev.resonance.game;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AudioFiles")
public class AudioFilesPlugin extends Plugin {
    private static class ImportException extends IOException {
        ImportException(String message) {
            super(message);
        }
    }

    private static final long MAX_BYTES = 40L * 1024 * 1024;
    private static final long MAX_TOTAL_BYTES = 160L * 1024 * 1024;
    private static final int MAX_FILES = 20;
    private final Map<String, File> transfers = new ConcurrentHashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Object transferLock = new Object();
    private File transferDirectory;
    private boolean destroyed;
    private boolean pickerOpen;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;

    @Override
    public void load() {
        transferDirectory = new File(getContext().getCacheDir(), "audio-transfers");
        transferDirectory.mkdirs();
        File[] staleFiles = transferDirectory.listFiles();
        if (staleFiles != null) {
            for (File file : staleFiles) {
                file.delete();
            }
        }
        audioManager = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build())
            .setAcceptsDelayedFocusGain(false)
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener(change -> {
                if (change == AudioManager.AUDIOFOCUS_LOSS
                    || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                    || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                    notifyListeners("interruption", new JSObject());
                    audioManager.abandonAudioFocusRequest(focusRequest);
                }
            }, new Handler(Looper.getMainLooper()))
            .build();
    }

    @PluginMethod
    public void pickAudioFiles(PluginCall call) {
        synchronized (transferLock) {
            if (pickerOpen) {
                call.reject("An audio picker is already open.");
                return;
            }
            pickerOpen = true;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "audioSelected");
        } catch (Exception exception) {
            synchronized (transferLock) {
                pickerOpen = false;
            }
            call.reject("No audio document picker is available.");
        }
    }

    @ActivityCallback
    private void audioSelected(PluginCall call, ActivityResult result) {
        synchronized (transferLock) {
            pickerOpen = false;
        }
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.resolve(new JSObject().put("files", new JSArray()));
            return;
        }
        LinkedHashSet<Uri> uris = new LinkedHashSet<>();
        ClipData clips = data.getClipData();
        if (clips != null) {
            if (clips.getItemCount() > MAX_FILES) {
                call.reject("Select no more than 20 audio files at once.");
                return;
            }
            for (int i = 0; i < clips.getItemCount(); i++) {
                uris.add(clips.getItemAt(i).getUri());
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        if (uris.size() > MAX_FILES) {
            call.reject("Select no more than 20 audio files at once.");
            return;
        }
        worker.execute(() -> copySelection(call, uris));
    }

    private void copySelection(PluginCall call, LinkedHashSet<Uri> uris) {
        Map<String, File> created = new HashMap<>();
        JSArray files = new JSArray();
        long selectionBytes = 0;
        try {
            for (Uri uri : uris) {
                if (!"content".equals(uri.getScheme())) {
                    throw new ImportException("Unsupported document source.");
                }
                String name = "audio";
                try (Cursor cursor = getContext().getContentResolver().query(
                        uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE },
                        null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)
                            && cursor.getLong(sizeIndex) > MAX_BYTES) {
                            throw new ImportException("Each audio file must be 40 MiB or smaller.");
                        }
                        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)
                            && cursor.getLong(sizeIndex) > MAX_TOTAL_BYTES - selectionBytes) {
                            throw new ImportException("The selected audio files must total 160 MiB or less.");
                        }
                        int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
                            name = cursor.getString(nameIndex);
                        }
                    }
                }
                name = name.replaceAll("[\\\\/\\p{Cntrl}]", "_");
                String id = UUID.randomUUID().toString();
                File target;
                synchronized (transferLock) {
                    if (destroyed) throw new ImportException("Audio import was interrupted.");
                    target = new File(transferDirectory, id);
                    transfers.put(id, target);
                    created.put(id, target);
                }
                long total = 0;
                try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                     FileOutputStream output = new FileOutputStream(target)) {
                    if (input == null) throw new ImportException("Unable to read the selected audio file.");
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        synchronized (transferLock) {
                            if (destroyed) throw new ImportException("Audio import was interrupted.");
                        }
                        total += count;
                        selectionBytes += count;
                        if (total > MAX_BYTES) {
                            throw new ImportException("Each audio file must be 40 MiB or smaller.");
                        }
                        if (selectionBytes > MAX_TOTAL_BYTES) {
                            throw new ImportException("The selected audio files must total 160 MiB or less.");
                        }
                        output.write(buffer, 0, count);
                    }
                }
                String mime = getContext().getContentResolver().getType(uri);
                files.put(new JSObject()
                    .put("id", id)
                    .put("name", name)
                    .put("type", mime == null ? "application/octet-stream" : mime)
                    .put("size", total)
                    .put("path", Uri.fromFile(target).toString()));
            }
            synchronized (transferLock) {
                if (destroyed) throw new ImportException("Audio import was interrupted.");
                call.resolve(new JSObject().put("files", files));
            }
        } catch (Exception exception) {
            for (Map.Entry<String, File> entry : created.entrySet()) {
                releaseTransfer(entry.getKey());
                entry.getValue().delete();
            }
            // Provider exceptions can contain the original content URI; never expose them.
            call.reject(exception instanceof ImportException
                ? exception.getMessage() : "Unable to import the selected audio files.");
        }
    }

    private void releaseTransfer(String id) {
        File file = transfers.remove(id);
        if (file != null) file.delete();
    }

    @PluginMethod
    public void release(PluginCall call) {
        String id = call.getString("id");
        if (id != null) releaseTransfer(id);
        call.resolve();
    }

    @PluginMethod
    public void requestAudioFocus(PluginCall call) {
        boolean granted = audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        call.resolve(new JSObject().put("granted", granted));
    }

    @PluginMethod
    public void abandonAudioFocus(PluginCall call) {
        audioManager.abandonAudioFocusRequest(focusRequest);
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        notifyListeners("interruption", new JSObject());
        audioManager.abandonAudioFocusRequest(focusRequest);
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (transferLock) {
            destroyed = true;
            for (String id : transfers.keySet()) releaseTransfer(id);
        }
        worker.shutdownNow();
        audioManager.abandonAudioFocusRequest(focusRequest);
    }
}
