# VoiceCast — refresh flash fixed

Cause: app.html still contained the old globe home. The deferred home.js replaced that markup only after scripts finished loading, exposing the old design on first paint.

Fix: app.html now contains the final logo home, call-to-action buttons, language panel, feature heading and interpreter card directly. home.js enhances that existing HTML with animation and interactions instead of rebuilding the page. Updated asset keys are v8.

All prior revolving-logo, intro and interpreter features remain included.

Deploy: extract the complete translation-app folder, open the folder containing Dockerfile in your terminal, and run your existing deployment command:

gcloud run deploy voicecast-translate-svc --source . --region asia-south1

Use the same Google Cloud project as the existing deployment. This package has not been deployed automatically. After successful deployment, refresh /app.html on your existing service.

Validation: final home visible with home.js deliberately held back, final home rendered with JavaScript disabled, no legacy globe markup, no duplicate sections after initialization, 27 language shortcuts, search, navigation, responsive layouts and revolving motion checks passed in Chrome. Syntax checks passed. Live cloud services were not end-to-end tested.
