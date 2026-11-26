type Passages = Record<string, string[]>;

export class TranslationPopup {
  private passages: Passages = {};
  private popup?: HTMLElement;

  setPassages(passages: Passages) {
    this.close();
    this.passages = passages;
  }

  close = () => {
    this.popup?.remove();
    this.popup = undefined;
  };

  listen(container: HTMLElement, signal: AbortSignal) {
    container.addEventListener('contextmenu', this.open, {signal});
    container.addEventListener('scroll', this.close, {signal, passive: true});
    window.addEventListener('resize', this.close, {signal});
    document.addEventListener('pointerdown', event => {
      if (this.popup && !event.composedPath().includes(this.popup)) this.close();
    }, {signal, capture: true});
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.popup) {
        event.preventDefault();
        this.close();
      }
    }, {signal});
  }

  private open = (event: MouseEvent) => {
    const page = event.target instanceof Element && event.target.closest('.page');
    if (!page || !Object.keys(this.passages).length) return;

    // The highlight overlay stays transparent to pointers for normal PDF selection.
    const hit = [...page.querySelectorAll<HTMLElement>('.highlight[data-anchor]')].reverse().find(mark => {
      const box = mark.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX < box.right &&
        event.clientY >= box.top && event.clientY < box.bottom;
    });
    const translation = hit && this.passages[hit.dataset.candidate ?? '']?.[Number(hit.dataset.anchor)];
    if (!translation) return;
    event.preventDefault();
    this.close();

    const popup = document.createElement('aside');
    popup.className = 'translation-popup';
    popup.lang = 'zh-CN';
    popup.setAttribute('aria-label', '简体中文译文');
    popup.setAttribute('role', 'status');
    popup.textContent = translation;
    document.body.append(popup);
    this.popup = popup;

    const gap = 10;
    const {width, height} = popup.getBoundingClientRect();
    const below = event.clientY + gap;
    const top = below + height <= document.documentElement.clientHeight - gap
      ? below : event.clientY - height - gap;
    popup.style.left = `${Math.max(gap, Math.min(event.clientX, document.documentElement.clientWidth - width - gap))}px`;
    popup.style.top = `${Math.max(gap, top)}px`;
  };
}
