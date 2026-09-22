# Color, resolution and document delivery

## Preserve meaning before export

- Inspect the source's embedded profile and intended destination. For ordinary screen previews, an sRGB derivative is a useful default; preserve the working master and embed an appropriate profile.
- Assigning a profile changes the interpretation of existing numbers. Converting maps values between profiles to preserve appearance as far as the destination allows. Do not fix an apparent mismatch by assigning a random profile.
- For an untagged source, record the uncertainty and use a stated assumption or obtain the intended profile when color fidelity is critical. Judge comparisons under consistent color handling.
- Keep existing bit depth unless a supported operation or destination requires a change. Higher precision can help avoid new banding during heavy grading, but conversion cannot recreate detail already lost in an 8-bit image.
- Pixel dimensions determine raster detail. Resolution metadata alone does not add pixels. For print, agree physical dimensions, supplier resolution, bleed and output profile before final layout; do not assume every printer wants the same CMYK setup.
- Check operation support for the document's mode and bit depth before applying filters. Use a derivative for a required conversion when the original must remain intact.

## Save the editable master

Save a versioned PSD when suitable; use PSB when document dimensions or file size exceed PSD support and verify recipient compatibility. Do not promise all target applications will accept PSB or every Photoshop feature.

Preserve live text, vector shapes, masks, adjustment layers and Smart Object structure as required. Embedded assets travel with the document; linked assets need stable paths and must be delivered together or embedded when appropriate. Record font dependencies; font redistribution is not an automatic part of a project handoff.

A successful save is one check. Also verify the intended path exists, read the saved version where available and confirm its dimensions and editable layers. Reopen safely without closing or overwriting a user's unsaved document. If reopening is unsupported, report that it has not been verified rather than implying it passed.

## Export derivatives deliberately

| Deliverable | Check |
|---|---|
| PNG with transparency | Alpha, fringe colors, dimensions and intended crop |
| JPEG preview | Intentional background, color handling, compression and absence of required transparency |
| Layer assets for motion | Shared canvas origin or explicit offsets, overlap margins, alpha and naming |
| Print derivative | Agreed physical size, bleed, profile and recipient-specific requirements |

Resize once near delivery when possible; judge output sharpening after resizing, at the actual output scale. Never rely on a small preview to assess hair, mask edges, type rendering or compression artifacts.

## Separate quality claims

1. **Appearance:** composition, legibility, edges, lighting and reference fidelity have been visually inspected.
2. **Structure:** the requested elements are independently editable and dependencies resolve.
3. **Persistence:** a saved file exists and has been reopened/read when available.
4. **Handoff:** the recipient or canvas can access the exact delivered version.

Report the checks actually completed. A PSD with one flattened layer may satisfy appearance but fails an independently editable layout requirement. A perfect local document with unresolved linked files fails a portable handoff.
