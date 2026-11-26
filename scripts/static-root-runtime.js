/* Progressive enhancement for the complete, server-readable VIP10 homepage. */
(() => {
  'use strict';
  const menu = document.querySelector('.mobile-menu-toggle');
  const navigation = document.getElementById('primary-navigation');
  if (menu && navigation) {
    menu.addEventListener('click', () => {
      const expanded = menu.getAttribute('aria-expanded') !== 'true';
      menu.setAttribute('aria-expanded', String(expanded));
      navigation.style.display = expanded ? 'flex' : '';
    });
    navigation.addEventListener('click', event => {
      if (event.target.closest('a')) {
        menu.setAttribute('aria-expanded', 'false');
        navigation.style.display = '';
      }
    });
  }
  document.querySelectorAll('button[aria-label="Copy VIP10 discount code"]').forEach(button => {
    button.addEventListener('click', async () => {
      let copied = false;
      try {
        await navigator.clipboard.writeText('VIP10');
        copied = true;
      } catch {
        const field = document.createElement('textarea');
        field.value = 'VIP10';
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        try { copied = document.execCommand('copy'); } catch { copied = false; }
        field.remove();
      }
      const label = button.textContent;
      const background = button.style.backgroundColor;
      button.textContent = copied ? 'Copied VIP10' : 'Code: VIP10';
      if (copied) button.style.backgroundColor = '#248044';
      window.setTimeout(() => {
        button.textContent = label;
        button.style.backgroundColor = background;
      }, 2000);
    });
  });
})();
