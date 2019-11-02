const { userAgent } = navigator;

export const isFirefox = +userAgent.match(/firefox\/(\d+)|$/i)[1] || false;
export const isChrome = /chrome\//i.test(userAgent);
export const isAndroid = /android /i.test(userAgent);
