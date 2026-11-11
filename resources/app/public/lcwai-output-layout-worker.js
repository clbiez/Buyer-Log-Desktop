/* Local, on-demand presentation planning; the same geometry module serves exports. */
'use strict';
self.window = self;
importScripts('lcwai-output-layout.js');
self.onmessage = event => {
  try {
    const { slides, layout, records, english } = event.data;
    self.postMessage({ pages: self.BLOutputLayout.expandGalleries(slides, layout, { records, english }) });
  } catch (_) { self.postMessage({ error: true }); }
};
