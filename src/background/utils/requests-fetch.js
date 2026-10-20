import { buffer2string } from '@/common';

const CHUNK_SIZE = 1e6;
const TEXT_CHUNK_SIZE = 10e6;

export default async function initFetch(opts, req, events, url, headers, body) {
  const controller = new AbortController();
  const stream = opts[kResponseType] === 'stream';
  const binary = opts[kXhrType];
  const textChunks = [];
  const byteChunks = [];
  const sentText = !stream && !binary && opts[kResponseType] !== 'json' && events[0].progress;
  let aborted;
  let finished;
  let timer;
  let contentType = '';
  let responseHeaders = '';
  let loaded = 0;
  let total = 0;
  let endResponse = null;
  let endChunked = false;
  let metadata = { finalUrl: url.split('#', 1)[0], readyState: 0, status: 0, statusText: '' };
  req.xhr = {
    abort() {
      if (!finished && !aborted) {
        aborted = 'abort';
        controller.abort();
      }
    },
  };
  const notify = (type, response = null, extra) => {
    if (stream || events[0][type] || type === 'loadend' || type === ERROR) {
      return req.cb({
        id: req.id,
        type,
        stream,
        contentType,
        data: {
          ...metadata,
          lengthComputable: total > 0,
          loaded,
          total,
          [kResponseHeaders]: req[kResponseHeaders] || responseHeaders,
          [kResponse]: response,
        },
        ...extra,
      });
    }
  };
  try {
    const fetchUrl = new URL(url);
    const user = opts.user || decodeURIComponent(fetchUrl.username);
    const password = opts.password || decodeURIComponent(fetchUrl.password);
    if ((user || password) && !Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) {
      headers.Authorization = `Basic ${btoa(buffer2string(new TextEncoder().encode(`${user}:${password}`)))}`;
    }
    fetchUrl.username = fetchUrl.password = '';
    const timeout = Math.max(0, Math.min(0x7FFF_FFFF, opts.timeout)) || 0;
    if (timeout) timer = setTimeout(() => {
      if (!finished && !aborted) {
        aborted = 'timeout';
        controller.abort();
      }
    }, timeout);
    if (req.aborted) req.xhr.abort();
    const response = await fetch(fetchUrl.href, {
      method: opts.method || 'GET',
      headers,
      body,
      credentials: opts.anonymous ? 'omit' : 'include',
      redirect: opts.redirect || 'follow',
      cache: opts.nocache ? 'no-store' : opts.revalidate ? 'no-cache' : 'default',
      signal: controller.signal,
    });
    metadata = {
      finalUrl: response.url || fetchUrl.href.split('#', 1)[0],
      readyState: 2,
      status: response.status,
      statusText: response.statusText,
    };
    response.headers.forEach((value, name) => { responseHeaders += `${name}: ${value}\r\n`; });
    contentType = opts.overrideMimeType || response.headers.get('content-type') || '';
    total = +response.headers.get('content-length') || 0;
    let decoder;
    if (!stream && !binary) {
      const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
      try { decoder = new TextDecoder(charset || 'utf-8'); }
      catch { decoder = new TextDecoder(); }
    }
    await notify('loadstart');
    const reader = response.body?.getReader();
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      if (controller.signal.aborted) throw new Error('Request aborted');
      loaded += value.length;
      metadata.readyState = 3;
      if (stream) {
        for (let i = 0; i < value.length; i += CHUNK_SIZE) {
          await notify('progress', encodeBytes(value.subarray(i, i + CHUNK_SIZE)));
        }
      } else if (binary) {
        for (let i = 0; i < value.length; i += CHUNK_SIZE) {
          byteChunks.push(value.subarray(i, i + CHUNK_SIZE));
        }
        await notify('progress');
      } else {
        const text = decoder.decode(value, { stream: true });
        if (sentText) await notify('progress', text);
        else {
          textChunks.push(text);
          await notify('progress');
        }
      }
    }
    if (controller.signal.aborted) throw new Error('Request aborted');
    let responseBody = null;
    let chunked = false;
    if (decoder) {
      const tail = decoder.decode();
      if (sentText) {
        if (tail) await notify('progress', tail);
      } else {
        textChunks.push(tail);
        responseBody = textChunks.join('');
        if (responseBody.length > TEXT_CHUNK_SIZE) {
          chunked = true;
          for (let i = 1; i * TEXT_CHUNK_SIZE < responseBody.length; i++) {
            await req.cb({
              id: req.id,
              chunk: i * TEXT_CHUNK_SIZE,
              i,
              data: responseBody.slice(i * TEXT_CHUNK_SIZE, (i + 1) * TEXT_CHUNK_SIZE),
            });
          }
          responseBody = responseBody.slice(0, TEXT_CHUNK_SIZE);
        }
      }
    } else if (binary) {
      chunked = true;
      let offset = byteChunks[0]?.length || 0;
      for (let i = 1; i < byteChunks.length; i++) {
        const value = byteChunks[i];
        await req.cb({ id: req.id, chunk: offset, i, data: encodeBytes(value), size: loaded });
        offset += value.length;
      }
      responseBody = byteChunks.length ? encodeBytes(byteChunks[0]) : '';
    }
    finished = true;
    metadata.readyState = 4;
    if (!stream && events[0].readystatechange) {
      await notify('readystatechange', responseBody, { chunked });
      responseBody = null;
      chunked = false;
    } else {
      await notify('readystatechange');
    }
    if (stream || events[0].load) await notify('load', responseBody, { chunked });
    else {
      endResponse = responseBody;
      endChunked = chunked;
    }
  } catch (err) {
    finished = true;
    metadata = { ...metadata, readyState: 4, status: 0, statusText: '' };
    await notify('readystatechange');
    await notify(aborted || ERROR, null, {
      streamError: [err.message || `${err}`, aborted === 'timeout' ? 'TimeoutError'
        : aborted ? 'AbortError' : err.name || 'Error'],
    });
  } finally {
    clearTimeout(timer);
    await notify('loadend', endResponse, { chunked: endChunked });
  }
}

function encodeBytes(value) {
  return value.toBase64 ? value.toBase64()
    : btoa(buffer2string(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
}
