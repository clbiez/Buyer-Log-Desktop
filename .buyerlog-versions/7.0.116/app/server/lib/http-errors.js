'use strict';

/* raw-body uses this type when the browser closes an upload/request before the
   body has arrived. It is a transport lifecycle event, not an application
   failure; other errors must continue through the normal error pipeline. */
function isClientRequestAborted(error) {
  return Boolean(error && (
    error.type === 'request.aborted' ||
    (error.code === 'ECONNABORTED' && /abort/i.test(String(error.message || '')))
  ));
}

module.exports = { isClientRequestAborted };
