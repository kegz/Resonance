import { EMPTY_INPUT, type InputState } from '../types';

const keys: Record<string, keyof InputState> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyE: 'interact',
  ArrowDown: 'interact', KeyR: 'rewind',
};

export class InputControls {
  private keyboard = new Set<string>();
  private pointers = new Map<number, keyof InputState>();
  private cleanup: (() => void)[] = [];

  constructor(root: HTMLElement, onPause: () => void) {
    const listen = <K extends keyof WindowEventMap>(
      name: K, handler: (event: WindowEventMap[K]) => void,
    ) => {
      window.addEventListener(name, handler);
      this.cleanup.push(() => window.removeEventListener(name, handler));
    };
    listen('keydown', (event) => {
      if (event.target instanceof HTMLElement &&
          event.target.closest('input, select, textarea, button')) return;
      if (keys[event.code]) {
        event.preventDefault();
        this.keyboard.add(event.code);
      }
      if (event.code === 'Escape' && !event.repeat) onPause();
    });
    listen('keyup', (event) => { this.keyboard.delete(event.code); });
    listen('blur', () => this.reset());
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-control]')) {
      const down = (event: PointerEvent) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, button.dataset.control as keyof InputState);
      };
      const up = (event: PointerEvent) => { this.pointers.delete(event.pointerId); };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('lostpointercapture', up);
      this.cleanup.push(() => {
        button.removeEventListener('pointerdown', down);
        button.removeEventListener('pointerup', up);
        button.removeEventListener('pointercancel', up);
        button.removeEventListener('lostpointercapture', up);
      });
    }
  }

  get state(): InputState {
    const state = { ...EMPTY_INPUT };
    for (const code of this.keyboard) state[keys[code]] = true;
    for (const action of this.pointers.values()) state[action] = true;
    return state;
  }

  reset() {
    this.keyboard.clear();
    this.pointers.clear();
  }

  dispose() {
    this.reset();
    this.cleanup.forEach((remove) => remove());
  }
}
