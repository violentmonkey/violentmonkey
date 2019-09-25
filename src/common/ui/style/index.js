import options from '../../options';
import './style.css';

let style;
options.hook((changes) => {
  if ('customCSS' in changes) setStyle(changes.customCSS);
});

try {
  // apply customCSS early to avoid FOUC during page load
  setStyle(browser.extension.getBackgroundPage().getOption('customCSS'));
} catch (e) {
  // let options.hook() handle it
}

function setStyle(css) {
  if (css && !style) {
    // Adding on documentElement puts it after <head> so it'll follow our own styles
    // which is important to ensure customCSS wins in cases of equal CSS specificity.
    // Note, DOM spec allows any elements under documentElement
    // https://dom.spec.whatwg.org/#node-trees
    style = document.documentElement.appendChild(document.createElement('style'));
  }
  if (style && style.textContent !== css) {
    style.textContent = css;
  }
}
