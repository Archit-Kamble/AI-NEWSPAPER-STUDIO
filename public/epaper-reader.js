(() => {
  const devanagariDigits = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
  const searchText = (value) => String(value || '').toLocaleLowerCase().replace(/[०-९]/g, (digit) => devanagariDigits[digit]);
  const toast = (message) => {
    const node = document.querySelector('.epaper-toast');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 4200);
  };

  // -------------------------------------------------------------- archive ---
  const search = document.querySelector('[data-archive-search]');
  if (search) {
    const cards = [...document.querySelectorAll('[data-archive-card]')];
    const empty = document.querySelector('[data-archive-empty]');
    const paint = () => {
      const query = searchText(search.value.trim());
      let shown = 0;
      cards.forEach((card) => {
        const match = !query || (card.dataset.search || '').includes(query);
        card.hidden = !match;
        if (match) shown += 1;
      });
      if (empty) {
        empty.hidden = shown > 0;
        if (!shown) empty.textContent = query ? 'No published edition matches that search.' : 'No published editions yet.';
      }
    };
    search.addEventListener('input', paint);
    paint();
  }

  // ------------------------------------------------------------ page turn ---
  const pages = [...document.querySelectorAll('[data-page]')];
  const buttons = [...document.querySelectorAll('[data-page-button]')];
  const stage = document.querySelector('[data-page-stage]');
  let current = 0;

  const showPage = (index, { focus = false } = {}) => {
    if (!pages.length) return;
    current = Math.max(0, Math.min(pages.length - 1, index));
    pages.forEach((page, i) => { page.hidden = i !== current; });
    buttons.forEach((button, i) => {
      if (i === current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    buttons[current]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    if (focus) stage?.focus({ preventScroll: true });
  };

  buttons.forEach((button, index) => button.addEventListener('click', () => showPage(index)));
  document.querySelector('[data-page-prev]')?.addEventListener('click', () => showPage(current - 1));
  document.querySelector('[data-page-next]')?.addEventListener('click', () => showPage(current + 1));
  stage?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); showPage(current - 1, { focus: true }); }
    if (event.key === 'ArrowRight') { event.preventDefault(); showPage(current + 1, { focus: true }); }
  });

  let touch = null;
  stage?.addEventListener('touchstart', (event) => {
    const point = event.changedTouches[0];
    touch = { x: point.clientX, y: point.clientY };
  }, { passive: true });
  stage?.addEventListener('touchend', (event) => {
    if (!touch) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - touch.x;
    const dy = point.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    showPage(current + (dx < 0 ? 1 : -1));
  }, { passive: true });

  // ---------------------------------------------------------- story cards ---
  const fileCache = new Map();
  const prepareFile = (share) => {
    if (!share?.dataset.shareImage) return Promise.resolve(null);
    const url = new URL(share.dataset.shareImage, location.href).href;
    if (!fileCache.has(url)) {
      const promise = fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`PNG HTTP ${response.status}`);
          return response.blob();
        })
        .then((blob) => new File([blob], `sahas-varta-${Date.now()}.png`, { type: 'image/png' }))
        .catch(() => null);
      fileCache.set(url, promise);
    }
    return fileCache.get(url);
  };

  const primeShare = async (dialog) => {
    const share = dialog?.querySelector('.story-share');
    const buttonsToEnable = [...(share?.querySelectorAll('[data-share-file]') || [])];
    buttonsToEnable.forEach((button) => { button.disabled = true; });
    const file = await prepareFile(share);
    buttonsToEnable.forEach((button) => { button.disabled = false; });
    if (!file && buttonsToEnable.length) toast('The PNG could not be prepared. You can still use Download PNG.');
  };

  const openDialog = (id) => {
    const dialog = document.getElementById(id);
    if (!dialog) return false;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    document.documentElement.style.overflow = 'hidden';
    primeShare(dialog);
    return true;
  };
  const closeDialog = (dialog) => {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    document.documentElement.style.overflow = '';
  };

  // Browsers are intentionally not allowed to post a file directly to a
  // Status or Story. They may hand it to the installed app through Web Share;
  // on desktop we open that app's web destination alongside the PNG download.
  const appDestination = (app, { url, text }) => ({
    'whatsapp-status': 'https://web.whatsapp.com/',
    'instagram-story': 'https://www.instagram.com/',
    'instagram-post': 'https://www.instagram.com/',
    'facebook-story': `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`,
  }[app] || '');

  // A single tap opens the card. A desktop double-click is a deliberate fast
  // path to the PNG itself, without making the reader first save a screenshot.
  const pendingStoryOpen = new WeakMap();
  const scheduleStoryOpen = (opener) => {
    clearTimeout(pendingStoryOpen.get(opener));
    const timer = setTimeout(() => {
      pendingStoryOpen.delete(opener);
      openDialog(opener.dataset.storyDialog);
    }, 230);
    pendingStoryOpen.set(opener, timer);
  };
  const downloadStoryPng = (opener) => {
    const dialog = document.getElementById(opener.dataset.storyDialog);
    const download = dialog?.querySelector('.share-download');
    if (!download?.href) return false;
    const link = document.createElement('a');
    link.href = download.href;
    link.download = download.getAttribute('download') || 'sahas-varta-story.png';
    document.body.append(link);
    link.click();
    link.remove();
    toast('Story PNG downloaded.');
    return true;
  };

  document.addEventListener('click', async (event) => {
    const opener = event.target.closest('[data-story-dialog]');
    if (opener) {
      if (opener.classList.contains('story-hotspot') && event.detail > 0) {
        event.preventDefault();
        scheduleStoryOpen(opener);
      } else if (openDialog(opener.dataset.storyDialog)) event.preventDefault();
      return;
    }
    const closer = event.target.closest('[data-close-dialog]');
    if (closer) return closeDialog(closer.closest('dialog'));

    const direct = event.target.closest('[data-direct-share]');
    if (direct) {
      event.preventDefault();
      const share = direct.closest('.story-share');
      const url = new URL(share.dataset.shareUrl || location.href, location.href).href;
      const title = share.dataset.shareTitle || document.title;
      const text = `${title} — ${url}`;
      const network = direct.dataset.directShare;
      const destinations = {
        whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
        x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
        linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
        email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`,
      };
      const destination = destinations[network];
      if (network === 'email') location.href = destination;
      else if (destination) window.open(destination, '_blank', 'noopener,noreferrer');
      return;
    }

    const shareButton = event.target.closest('[data-share-file]');
    if (!shareButton) return;
    const share = shareButton.closest('.story-share');
    const file = await prepareFile(share);
    const url = new URL(share.dataset.shareUrl || location.href, location.href).href;
    const target = shareButton.dataset.shareTarget || 'the app you choose';
    const data = { title: share.dataset.shareTitle || document.title, text: `${share.dataset.shareTitle || document.title}\n${url}`, url };
    if (file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ ...data, files: [file] });
        toast(`PNG sent to the share sheet. Choose ${target}.`);
      } catch (error) {
        if (error.name !== 'AbortError') toast(`Could not open sharing: ${error.message}`);
      }
    } else if (navigator.share) {
      try { await navigator.share(data); }
      catch (error) { if (error.name !== 'AbortError') toast(`Could not open sharing: ${error.message}`); }
    } else {
      share.querySelector('.share-download')?.click();
      const destination = appDestination(shareButton.dataset.shareApp, { url, text: data.text });
      if (destination) window.open(destination, '_blank', 'noopener,noreferrer');
      toast(destination ? `PNG downloaded and ${target} opened. Choose the PNG from your gallery.` : `PNG downloaded. Open ${target} and choose it from your gallery.`);
    }
  });

  document.addEventListener('dblclick', (event) => {
    const opener = event.target.closest('.story-hotspot[data-story-dialog]');
    if (!opener) return;
    event.preventDefault();
    clearTimeout(pendingStoryOpen.get(opener));
    pendingStoryOpen.delete(opener);
    downloadStoryPng(opener);
  });

  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
    dialog.addEventListener('close', () => { document.documentElement.style.overflow = ''; });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = document.querySelector('dialog[open]');
    if (open) closeDialog(open);
  });

  if (location.hash) {
    const target = document.querySelector(location.hash);
    const button = target?.querySelector('[data-story-dialog]');
    if (button) openDialog(button.dataset.storyDialog);
  }
})();
