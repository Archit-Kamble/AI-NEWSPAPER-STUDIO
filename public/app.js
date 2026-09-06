document.addEventListener("DOMContentLoaded", async () => {

    // A PICTURE WHOSE FILE HAS GONE, HANDLED ONCE FOR THE WHOLE APPLICATION.
    //
    // Four surfaces draw an <img> that may not resolve - the canvas's placed
    // picture, a block's thumbnail, the Pictures panel and the Story Explorer.
    // Each used to carry its own inline `onerror`, which a Content-Security-
    // Policy correctly refuses to run. One capture-phase listener at the
    // document covers all four and every image drawn after it, so it is bound
    // first, before anything can render one.
    const { bindBrokenImages } = await import("./ui/broken-image.js");
    bindBrokenImages();

    // Editor
    await import("./editor/publication.js");

    // Admin modules
    await import("./admin/reporter-browser.js");
    await import("./admin/template-selector.js");

    // Main application
    await import("./admin.js");

});