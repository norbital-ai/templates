The three camera samples are copied unchanged from MiniVision
[Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/b6d5f04ad78778917853b25c778acef6d5626d15/images/sample),
commit `b6d5f04ad78778917853b25c778acef6d5626d15`, under Apache-2.0.
The license is retained at `assets/models/LICENSE.minivision`.

`image_T1.jpg` is the upstream real sample; `image_F1.jpg` and `image_F2.jpg`
are its spoof samples. These are public upstream fixtures, not tenant or seed-bank data.
`reference.json` records the upstream RetinaFace boxes and the original two-model
fusion probabilities with OpenCV 4.12.0 preprocessing. Browser tests use the same
boxes to separate anti-spoof integration from face-detector accuracy.
