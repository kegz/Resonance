package dev.resonance.game;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class OfflinePackageTest {

    @Test
    public void usesPrivateOfflineStorageWithoutBroadPermissions() throws Exception {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("dev.resonance.game", appContext.getPackageName());
        PackageInfo info = appContext.getPackageManager().getPackageInfo(
            appContext.getPackageName(), PackageManager.GET_PERMISSIONS);
        assertEquals(29, info.applicationInfo.minSdkVersion);
        if (info.requestedPermissions != null) {
            for (String permission : info.requestedPermissions) {
                assertFalse(permission.contains("EXTERNAL_STORAGE"));
                assertFalse(permission.contains("READ_MEDIA_"));
                assertNotEquals("android.permission.INTERNET", permission);
                assertNotEquals("android.permission.READ_PHONE_STATE", permission);
            }
        }
    }
}
