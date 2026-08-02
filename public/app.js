document.addEventListener("DOMContentLoaded", async () => {

    // Editor
    await import("./editor/publication.js");

    // Admin modules
    await import("./admin/reporter-browser.js");
    await import("./admin/template-selector.js");

    // Main application
    await import("./admin.js");

});