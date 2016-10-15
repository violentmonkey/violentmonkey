var textarea = document.createElement('textarea');
document.body.appendChild(textarea);

var clipboardData = {};
function oncopy(e) {
  e.preventDefault();
  e.clipboardData.setData(clipboardData.type || 'text/plain', clipboardData.data);
}
document.addEventListener('copy', oncopy, false);

exports.set = function (data) {
  clipboardData.type = data.type;
  clipboardData.data = data.data;
  textarea.focus();
  document.execCommand('copy', false, null);
};
