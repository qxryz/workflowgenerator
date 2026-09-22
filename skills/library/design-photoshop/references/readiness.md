# Application readiness and recovery

Treat readiness as distinct evidence stages:

| Observation | Meaning | Next evidence |
|---|---|---|
| Application installation discovered | A candidate exists locally | Confirm intended version and launch if needed |
| Connector prepared | A control service has been installed/enabled | Inspect its supported application connection method |
| Application process observed | Photoshop appears to be running | Obtain a fresh application/document response |
| Document list received, including an explicit empty list | The current session can reach the application | Match the target document or create the requested new one |
| Layer tree and dimensions read | The intended document is observable | Confirm required editing operations are available |
| Saved document and preview verified | A specific output version was produced | Deliver accessible files and editing notes |

Do not infer one stage from another. Some installations require an application-side plugin; others use a different supported mechanism. Read the installed connector's actual instructions and reuse its own components. Do not import another application's bridge assumptions.

## Guide the user when the desktop application is missing

An empty standard-path scan, unavailable process inspection or a connection failure does not prove Photoshop is uninstalled. Check known installation records, running instances and custom paths first. If unresolved, ask whether it is installed and request its application path only when needed. Reuse a verified installation. Once the application is confirmed missing, pause dependent launch/editing instead of repeatedly installing the connector.

Explain that **Photoshop desktop** is required; Photoshop on the web or a mobile app does not satisfy this workflow. Provide [Adobe's official download and installation guide](https://helpx.adobe.com/download-install/apps/download-install-apps/creative-cloud-apps/download-creative-cloud-apps.html) and only the user's OS-specific steps, in their language:

- If Creative Cloud desktop is already installed, open Apps, find Photoshop and select Install.
- Otherwise follow the [official Creative Cloud desktop installation guide](https://helpx.adobe.com/download-install/apps/download-install-apps/creative-cloud-apps/download-creative-cloud-desktop-app-from-web.html). On Windows, run the downloaded `.exe`; on macOS, open the `.dmg` and run its installer. Complete setup, then install Photoshop from Apps.
- The user handles sign-in, purchase/trial choices, organization access and system prompts in Adobe or system UI. Do not choose a paid plan or collect passwords. Match the actual OS and the connector's documented version support; disclose unverified compatibility instead of automatically requiring the newest release.

Do not merely tell the user to search online. Give the official entry, concrete steps and what comes next. If the page is inaccessible, say so rather than inventing a direct download or substituting a third-party installer. Retain the brief, assets, target document and last verified step while installation is pending; continue independent asset inspection without a launch retry loop. When the user reports completion or fresh inspection finds the application, recheck its path/version, prepare or reuse the connector and follow section 2 of the skill to obtain a real document response. Resume after verification without asking for the brief or another “continue.” If discovery still fails, request only the installed path or specific installation error.

## Diagnosing a failed connection

Inspect the evidence already available: selected application version, whether it is running, connector preparation result, documented prerequisites and the latest application response. Capture only relevant diagnostics; avoid dumping personal documents, credentials or unrelated process details.

- **Application missing:** follow the installation guidance above. Connector preparation does not install Photoshop itself.
- **Several installations:** prefer the version already used by the intended document/connection; never automatically upgrade or close a running version.
- **Preparation entry unavailable:** use the existing connector interface if interaction is possible, or provide the specific manual step. Do not describe an unavailable automatic operation as completed.
- **Launch accepted, no document response:** inspect application startup/modal dialogs and the connector's documented plugin or permission prerequisites. A launch command alone cannot establish these.
- **Permission or login dialog:** have the user complete the system/application prompt when required; do not collect passwords in chat or disable security settings.
- **Unknown installation outcome:** inspect status before another installation. After a stale connection, refresh through supported host controls and perform a fresh read.
- **Partial document mutation:** inspect the current layers and saved checkpoint before resuming. Avoid duplicate layers caused by replaying the entire sequence.

Repeat an action only when evidence changed or a diagnosed cause was addressed. Preserve the creative brief, source mapping and last verified stage so the user can resume without uploading the same assets again.

Environment inspection is not visual verification. When the current session has no application interaction or document-read capability, report that precise limit; do not imply a skill grants capabilities the host does not expose.
