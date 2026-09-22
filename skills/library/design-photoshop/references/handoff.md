# Canvas and document handoff

## Canvas assets into Photoshop

Identify the intended selection and source revision. Obtain original assets where available instead of a screenshot of the canvas. Inspect dimensions, transparency, crop, fonts and layout geometry. A displayed preview does not guarantee the underlying source has editable layers or transparent pixels.

Keep a compact task manifest in the project directory when multiple assets or revisions need tracking: source asset names and versions, local file paths, intended document/layer roles, crop or placement information, and output version. Record user-visible relationships, not platform credentials or internal transport data.

For layouts assembled from several assets, reconstruct type and simple shapes as editable elements. Preserve each photograph separately and retain intentional overlaps. If the only input is a flattened image, label reconstructed or missing regions explicitly.

## Existing PSD revisions

Read the layer tree, document size/profile, linked sources and target content before editing. Identify the layer to change by its role and content as well as its identifier; names can be duplicated. If several documents plausibly match, resolve the ambiguity before mutation.

Save to a new version by default and preserve the source. For a narrow revision, change the corresponding elements and their direct dependencies. Do not rebuild the entire composition or rename unrelated layers. For variants, distinguish shared Smart Object content from independent content so one change does not silently affect every version.

## Photoshop back to the canvas

Completed creation or revision defaults to one exported PNG/JPEG image from the delivered PSD/PSB version, returned to the current Design canvas. Preserve required alpha with PNG and follow the color-and-delivery reference for a screen derivative without changing the master profile. Do not substitute an application screenshot. Honor explicit requests to skip export or canvas display; multiple requested artboards or variants retain their intended output count rather than exporting every layer by default.

For explicitly requested animation, verify that the installed application's available capabilities support the intended timeline and video export before promising it. Render the full intended range to a finished playable video, preferably supported MP4, and retain the editable source. If local assembly is needed, use a route that does not automatically publish intermediate media. Verify decoding, dimensions, duration, frame rate, required audio and representative beginning/middle/end frames. A still, thumbnail, screen recording or frame folder does not replace the video. If the capability is missing, explain that specific blocker without silently changing the task or claiming completion. Unrelated timeline data does not turn a static task into animation.

Export internal checks, frames and unverified media to a unique task directory outside the creative project's asset-scanning scope. Verify the final image decodes and inspect dimensions, composition, color, crop and required transparency. Export success or a filename suffix alone is insufficient. Keep the preview aligned with the saved source version; after edits, refresh it. Reuse an already verified requested final export as the preview.

After validation, copy or import the final media to persistent delivery storage and use available media import/display capabilities to return it to the canvas. Confirm the correct image/video node references the actual file and displays the image or provides playable video; do not leave final nodes dependent on temporary files. Preserve the original asset and record the output's source correspondence. Reuse a node already created by automatic collection, without a duplicate preview or extra video-thumbnail node. Inspect nodes before retrying an unknown publication outcome; do not re-export solely to register an existing verified file.

Attach the PSD/PSB when supported; otherwise provide the editable document path separately and state the import restriction. Export, validation and canvas delivery are separate checks. A chat attachment or path alone does not confirm a canvas node. On failure, preserve the source and resumable data, repair the failed step or mark canvas handoff pending rather than reporting full completion.

Importing a PSD file does not automatically turn its layers into native canvas objects. A preview is for viewing; the PSD is for continued Photoshop editing. Do not call the handoff complete until the output is accessible through the supported destination or clearly identify the remaining step.

## Preparing for later motion

Separate foreground, middle ground, background and text according to intended motion. Reconstruct hidden overlap only as needed for the movement. Preserve a consistent canvas size or record crop offsets for separately exported layers. Keep masks and text editable in the master even if the downstream application uses raster derivatives.

Do not promise cross-application preservation of every layer style, adjustment or Smart Object. Verify the receiving workflow's actual interpretation and deliver previews to compare. Return to the original document for changes instead of repeatedly editing compressed exports.
