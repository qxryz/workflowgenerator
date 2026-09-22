// Function body for MCP execute-script. Read-only; no project switching or saving.
// Optional prefix: var AUDIT_COMP_IDS = [actualCompId];
var report = {
    schemaVersion: 1, status: "inspected", projectPath: null,
    scope: "whole-project", comps: [], files: [], fonts: [],
    counts: {layers: 0, textLayers: 0, shapeLayers: 0, keyframes: 0, expressions: 0},
    expressionErrors: [], unreadable: [], truncated: false,
    limitations: ["Expression errors are current-state only, not a full timeline evaluation.",
        "Font names do not prove font availability.",
        "Target scope follows source references, not expression-based comp references.",
        "This report does not verify visual quality, render success or editability by substitution."]
};
if (!app.project) { report.status = "no-project"; return report; }
if (app.project.file) report.projectPath = app.project.file.fsName;
var requested = typeof AUDIT_COMP_IDS !== "undefined" ? AUDIT_COMP_IDS : null;
var visited = {}, propertiesSeen = 0, LIMIT_PROPERTIES = 100000, LIMIT_LAYERS = 3000;
function issue(where, error) {
    if (report.unreadable.length < 100) report.unreadable.push({at: where, error: String(error)});
    else report.truncated = true;
}
function uniqueFont(font) {
    for (var f = 0; f < report.fonts.length; f++) if (report.fonts[f] === font) return;
    report.fonts.push(font);
}
function scanProperty(prop, where, depth) {
    if (!prop) return;
    propertiesSeen++;
    if (propertiesSeen > LIMIT_PROPERTIES || depth > 64) { report.truncated = true; return; }
    try {
        if (prop.propertyType === PropertyType.PROPERTY) {
            report.counts.keyframes += prop.numKeys || 0;
            if (prop.canSetExpression && prop.expressionEnabled) {
                report.counts.expressions++;
                if (prop.expressionError) report.expressionErrors.push({at: where, error: prop.expressionError});
            }
        } else {
            for (var p = 1; p <= prop.numProperties; p++) {
                if (propertiesSeen >= LIMIT_PROPERTIES) { report.truncated = true; break; }
                var child = prop.property(p);
                scanProperty(child, where + "/" + p + ":" + (child ? child.matchName : "null"), depth + 1);
            }
        }
    } catch (e) { issue(where, e); }
}
function inspectItem(item) {
    if (!item || visited["id" + item.id]) return;
    visited["id" + item.id] = true;
    if (item instanceof FootageItem) {
        try {
            if (item.file) report.files.push({itemId: item.id, name: item.name, role: "source",
                path: item.file.fsName, exists: item.file.exists,
                hasVideo: item.hasVideo, hasAudio: item.hasAudio});
        } catch (e) { issue("footage:" + item.id, e); }
    }
    try {
        if (item.useProxy) {
            var proxy = item.proxySource;
            report.files.push({itemId: item.id, name: item.name, role: "active-proxy",
                path: proxy && proxy.file ? proxy.file.fsName : null,
                exists: proxy && proxy.file ? proxy.file.exists : null});
        }
    } catch (e) { issue("proxy:" + item.id, e); }
    if (!(item instanceof CompItem)) return;
    var comp = {id: item.id, name: item.name, width: item.width, height: item.height,
        duration: item.duration, frameRate: item.frameRate, layerCount: item.numLayers, layers: []};
    report.comps.push(comp);
    for (var n = 1; n <= item.numLayers; n++) {
        if (report.counts.layers >= LIMIT_LAYERS) { report.truncated = true; break; }
        var layer = item.layer(n), where = "comp:" + item.id + "/layer:" + layer.id;
        report.counts.layers++;
        try {
            var row = {id: layer.id, name: layer.name, matchName: layer.matchName,
                enabled: layer.enabled, parentId: layer.parent ? layer.parent.id : null,
                sourceId: layer.source ? layer.source.id : null};
            if (typeof layer.audioEnabled !== "undefined") row.audioEnabled = layer.audioEnabled;
            comp.layers.push(row);
            if (layer.matchName === "ADBE Vector Layer") report.counts.shapeLayers++;
            if (layer instanceof TextLayer) {
                report.counts.textLayers++;
                uniqueFont(layer.property("ADBE Text Properties").property("ADBE Text Document").value.font);
            }
            for (var p = 1; p <= layer.numProperties; p++) {
                scanProperty(layer.property(p), where + "/" + p, 0);
            }
            if (layer.source) inspectItem(layer.source);
        } catch (e) { issue(where, e); }
    }
}
if (requested !== null) {
    report.scope = "target-source-closure";
    if (!(requested instanceof Array) || requested.length === 0) {
        issue("AUDIT_COMP_IDS", "Expected a non-empty array of current composition IDs");
    } else {
        for (var r = 0; r < requested.length; r++) {
            var found = null;
            for (var i = 1; i <= app.project.numItems; i++) {
                var candidate = app.project.item(i);
                if (candidate instanceof CompItem && candidate.id === requested[r]) { found = candidate; break; }
            }
            if (found) inspectItem(found); else issue("AUDIT_COMP_IDS", "Composition not found: " + requested[r]);
        }
    }
} else {
    for (var i = 1; i <= app.project.numItems; i++) inspectItem(app.project.item(i));
}
report.missingFiles = [];
for (var i = 0; i < report.files.length; i++) {
    if (report.files[i].exists === false) report.missingFiles.push(report.files[i].path);
}
if (report.unreadable.length || report.truncated) report.status = "incomplete";
else if (!report.comps.length) report.status = "empty";
else if (report.missingFiles.length || report.expressionErrors.length) report.status = "issues-found";
return report;
