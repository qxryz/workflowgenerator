const SAFE_HTML_TAGS = new Set([
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
]);

const DROP_HTML_SUBTREES = new Set([
    "base",
    "button",
    "embed",
    "form",
    "iframe",
    "input",
    "link",
    "math",
    "meta",
    "object",
    "script",
    "select",
    "style",
    "svg",
    "template",
    "textarea",
]);

const SAFE_SVG_TAGS = new Set([
    "circle",
    "clippath",
    "defs",
    "desc",
    "ellipse",
    "feblend",
    "fecolormatrix",
    "fegaussianblur",
    "feoffset",
    "filter",
    "g",
    "line",
    "lineargradient",
    "marker",
    "mask",
    "path",
    "polygon",
    "polyline",
    "radialgradient",
    "rect",
    "stop",
    "svg",
    "text",
    "title",
    "tspan",
]);

const SAFE_SVG_ATTRIBUTES = new Set([
    "accent-height",
    "alignment-baseline",
    "baseline-shift",
    "clip-path",
    "clip-rule",
    "color",
    "cx",
    "cy",
    "d",
    "dx",
    "dy",
    "fill",
    "fill-opacity",
    "fill-rule",
    "filter",
    "filterunits",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "fx",
    "fy",
    "gradienttransform",
    "gradientunits",
    "height",
    "id",
    "marker-end",
    "marker-mid",
    "marker-start",
    "markerheight",
    "markerunits",
    "markerwidth",
    "mask",
    "offset",
    "opacity",
    "orient",
    "pathlength",
    "patternunits",
    "points",
    "preserveaspectratio",
    "r",
    "refx",
    "refy",
    "rx",
    "ry",
    "spreadmethod",
    "stop-color",
    "stop-opacity",
    "stroke",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke-width",
    "text-anchor",
    "transform",
    "viewbox",
    "width",
    "x",
    "x1",
    "x2",
    "y",
    "y1",
    "y2",
]);

function safeLink(value: string, image = false) {
    const trimmed = value.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("/")) return true;
    if (image && /^(?:data:image\/(?:gif|jpe?g|png|webp);base64,|blob:)/iu.test(trimmed)) return true;
    try {
        const protocol = new URL(trimmed, window.location.href).protocol;
        return image ? protocol === "http:" || protocol === "https:" : ["http:", "https:", "mailto:"].includes(protocol);
    } catch {
        return false;
    }
}

function sanitizeHtmlElement(element: Element) {
    Array.from(element.children).forEach(sanitizeHtmlElement);
    const tag = element.localName.toLowerCase();
    if (!SAFE_HTML_TAGS.has(tag)) {
        if (DROP_HTML_SUBTREES.has(tag)) element.remove();
        else element.replaceWith(...Array.from(element.childNodes));
        return;
    }

    const tagAttributes: Record<string, Set<string>> = {
        a: new Set(["href", "title"]),
        img: new Set(["alt", "height", "src", "title", "width"]),
        ol: new Set(["start"]),
        td: new Set(["colspan", "rowspan"]),
        th: new Set(["colspan", "rowspan"]),
        code: new Set(["class"]),
    };
    const allowed = tagAttributes[tag] || new Set<string>();
    Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (!allowed.has(name)) element.removeAttribute(attribute.name);
    });
    if (tag === "a") {
        const href = element.getAttribute("href");
        if (href && !safeLink(href)) element.removeAttribute("href");
        element.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "img") {
        const src = element.getAttribute("src");
        if (src && !safeLink(src, true)) element.removeAttribute("src");
    }
}

export function sanitizeMarkdownHtml(markup: string) {
    const document = new DOMParser().parseFromString(markup, "text/html");
    Array.from(document.body.children).forEach(sanitizeHtmlElement);
    return document.body.innerHTML;
}

function isSafeSvgPaint(value: string) {
    return !/url\s*\(/iu.test(value) || /^url\(#[A-Za-z_][\w:.-]*\)$/u.test(value.trim());
}

function sanitizeSvgElement(element: Element) {
    Array.from(element.children).forEach(sanitizeSvgElement);
    const tag = element.localName.toLowerCase();
    if (!SAFE_SVG_TAGS.has(tag)) {
        element.remove();
        return;
    }
    Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.localName.toLowerCase();
        const value = attribute.value;
        if (!SAFE_SVG_ATTRIBUTES.has(name) || (["fill", "stroke", "filter", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"].includes(name) && !isSafeSvgPaint(value))) {
            element.removeAttribute(attribute.name);
        }
    });
}

export function sanitizeSvgMarkup(markup: string) {
    const document = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = document.documentElement;
    if (root.localName.toLowerCase() !== "svg" || document.querySelector("parsererror")) return "";
    sanitizeSvgElement(root);
    return root.isConnected ? new XMLSerializer().serializeToString(root) : "";
}
