import { debounce } from 'src/common';

let position;
let start = -1;
let debouncedCheck;

export function initialize(db) {
  position = 0;
  const os = db.transaction('scripts', 'readwrite').objectStore('scripts');
  debouncedCheck = debounce(initCheck(db), 300);
  return new Promise(resolve => {
    os.index('position').openCursor(null, 'prev').onsuccess = e => {
      const { result } = e.target;
      if (result) position = result.key;
      resolve();
    };
  });
}

function initCheck(db) {
  return function doCheck() {
    const tx = db.transaction('scripts', 'readwrite');
    const os = tx.objectStore('scripts');
    let offset = Math.max(1, start);
    start = -1;
    const updates = [];
    return new Promise(resolve => {
      os.index('position').openCursor(start).onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          const { value } = cursor;
          if (value.position !== offset) updates.push({ id: value.id, position: offset });
          if (position < offset) position = offset;
          offset += 1;
          cursor.continue();
        } else {
          resolve();
        }
      };
    })
    .then(updatePosition)
    .then(() => {
      browser.runtime.sendMessage({
        cmd: 'ScriptsUpdated',
      });
    });
    function updatePosition() {
      const item = updates.shift();
      if (item) {
        return new Promise(resolve => {
          os.get(item.id).onsuccess = e => {
            const { result } = e.target;
            result.position = item.position;
            os.put(result).onsuccess = () => { resolve(); };
          };
        })
        .then(updatePosition);
      }
    }
  };
}

export function check(startOffset = 0) {
  if (start < 0 || start > startOffset) start = startOffset;
  if (debouncedCheck) debouncedCheck();
}

export function get() {
  return position + 1;
}

export function update(pos) {
  if (position < pos) position = pos;
}
