import options from '../../options';
import './style.css';

let style;
options.hook((changes) => {
  if ('customCSS' in changes) {
    const { customCSS } = changes;
    if (customCSS && !style) {
      style = document.createElement('style');
      document.head.appendChild(style);
    }
    if (customCSS || style) {
      style.textContent = customCSS;
    }
  }
});
