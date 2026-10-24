# MediaPipe hand tracking

Self-hosted so camera play works on a room's Wi-Fi with no internet.

| File | Source | Licence |
| --- | --- | --- |
| `hand_landmarker.task` (float16, 7.5 MB) | https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task, as documented at https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker | Apache-2.0 |
| `wasm/vision_wasm_internal.js`, `wasm/vision_wasm_internal.wasm` (13.2 MB) | npm `@mediapipe/tasks-vision@1.1.1`, `wasm/` folder (https://www.npmjs.com/package/@mediapipe/tasks-vision) | Apache-2.0 |

Copyright The MediaPipe Authors. Licensed under the Apache License, Version
2.0: https://www.apache.org/licenses/LICENSE-2.0

Only the SIMD wasm build is shipped. Every current browser supports wasm
SIMD (Safari since 16.4, Chrome since 91, Firefox since 89); older browsers
get a plain "this browser cannot do camera play" message.

SHA-256 at the time of copying:

```
fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1  hand_landmarker.task
6522286aa32dd93eff17c3da002b0649516f87abfec7a80b5bfe5c9625caa5f8  wasm/vision_wasm_internal.js
0e101a010e262ef8e78f22e3c95b60a9705fd06962753c9acd6356d9fb56b7bd  wasm/vision_wasm_internal.wasm
```

Privacy: MediaPipe processes every frame on the device. The library also
posts anonymous usage metrics (platform, version, latency) to
`odml.pa.googleapis.com` once a minute; Kilukkam pages that use the camera
block that request with `connect-src 'self'` in their Content-Security-Policy.
