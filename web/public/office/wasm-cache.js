/* Cache the large Office WASM module after its first successful compilation. */
'use strict';
(globalThis => {
  if (globalThis.__kadyOfficeWasmCache) return;
  const cacheKey = 'zeta-2025-05-13:9ebd9a487e849a24b9c69f843ebdb451709c27b7722c010e36433474a5bd4';
  const nativeInstantiateStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);

  function request(requestish) {
    return new Promise((resolve, reject) => {
      requestish.onsuccess = () => resolve(requestish.result);
      requestish.onerror = () => reject(requestish.error);
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('kady-office-runtime', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('wasmModules');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async function withStore(mode, operation) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('wasmModules', mode);
        const store = tx.objectStore('wasmModules');
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error);
        void operation(request(store.get(cacheKey)), store).then(resolve, reject);
      });
    } finally {
      db.close();
    }
  }

  async function instantiateModule(module, imports) {
    const instance = await WebAssembly.instantiate(module, imports);
    return { module, instance };
  }

  globalThis.__kadyOfficeWasmCache = true;
  WebAssembly.instantiateStreaming = async (source, imports) => {
    const url = source instanceof Response ? source.url : String(source);
    if (!url.endsWith('/soffice.wasm')) return nativeInstantiateStreaming(source, imports);
    try {
      const cached = await withStore('readonly', getRequest => getRequest);
      if (cached instanceof WebAssembly.Module) {
        console.info('[kady-office] restored compiled WASM from cache');
        return await instantiateModule(cached, imports);
      }
      const module = await WebAssembly.compileStreaming(source);
      try {
        await withStore('readwrite', (_, store) => Promise.resolve(store.put(module, cacheKey)));
        console.info('[kady-office] stored compiled WASM in cache');
      } catch { /* Quota or browser cloning policy; normal compilation still works. */ }
      console.info('[kady-office] compiled and cached Office WASM');
      return await instantiateModule(module, imports);
    } catch (error) {
      console.warn('[kady-office] compiled WASM cache unavailable:', error);
      return nativeInstantiateStreaming(source, imports);
    }
  };
})(globalThis);
