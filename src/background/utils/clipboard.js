const textarea = document.createElement('textarea');
document.body.appendChild(textarea);

const clipboardData = {};
function oncopy(e) {
  e.preventDefault();
  e.clipboardData.setData(clipboardData.type || 'text/plain', clipboardData.data);
}
document.addEventListener('copy', oncopy, false);

export default function setClipboard(data) {
  clipboardData.type = data.type;
  clipboardData.data = data.data;
  textarea.focus();
  document.execCommand('copy', false, null);
}
