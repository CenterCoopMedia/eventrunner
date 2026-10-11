export const timeline = {
  "id": "trailer-study",
  "title": "Event Runner — replacement direction study",
  "fps": 30,
  "bpm": 120,
  "duration": 600,
  "settle": 540,
  "kind": "trailer",
  "seed": 881,
  "periods": [
    105,
    195,
    360
  ],
  "silence": [
    502,
    510
  ],
  "cinematic": {
    "rule": 0,
    "lands": [
      24,
      42,
      72
    ],
    "pullback": 36,
    "plan": 90,
    "shape": 180,
    "gather": 345,
    "reveal": 405,
    "title": 510,
    "settle": 540,
    "preview": 225,
    "fold": 480,
    "pageLand": 438
  },
  "scenes": [
    {
      "id": "opening",
      "start": 0,
      "end": 90,
      "caption": "",
      "capture": "edit-section",
      "theme": "dark"
    },
    {
      "id": "plan-write",
      "start": 90,
      "end": 180,
      "caption": "Plan.",
      "capture": "editor-before",
      "word": "Plan",
      "theme": "brand",
      "typing": {
        "prefix": "typing-",
        "length": 33,
        "start": 114,
        "interval": 1
      }
    },
    {
      "id": "shape-choice",
      "start": 180,
      "end": 225,
      "caption": "Shape.",
      "capture": "style-before",
      "word": "Shape",
      "theme": "light",
      "after": "style-chosen",
      "action": {
        "target": "style",
        "moveStart": 190,
        "moveEnd": 200,
        "press": 204
      }
    },
    {
      "id": "shape-preview",
      "start": 225,
      "end": 285,
      "caption": "Shape.",
      "capture": "preview-phone-light",
      "word": "Shape",
      "theme": "light",
      "montage": [
        "preview-phone-light",
        "styled-home",
        "style-chosen"
      ]
    },
    {
      "id": "shape-publish",
      "start": 285,
      "end": 345,
      "caption": "Shape.",
      "capture": "theme-publish-hover",
      "word": "Shape",
      "theme": "light",
      "after": "theme-published",
      "action": {
        "target": "action",
        "moveStart": 298,
        "moveEnd": 310,
        "press": 315
      },
      "montage": [
        "preview-phone-light"
      ]
    },
    {
      "id": "gather-publish",
      "start": 345,
      "end": 405,
      "caption": "Gather.",
      "capture": "publish-hover",
      "word": "Gather",
      "theme": "dark",
      "after": "published",
      "action": {
        "target": "action",
        "moveStart": 364,
        "moveEnd": 373,
        "press": 378
      }
    },
    {
      "id": "reveal",
      "start": 405,
      "end": 510,
      "caption": "",
      "capture": "styled-public-home",
      "theme": "dark"
    },
    {
      "id": "end",
      "start": 510,
      "end": 600,
      "caption": "Make room for your event.",
      "capture": "styled-public-home",
      "endCard": true,
      "theme": "dark"
    }
  ]
};
