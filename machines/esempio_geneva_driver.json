{
  "title": "Esempio: Geneva con driver a due ruote (il perno lo calcola il codice)",
  "consts": {
    "N": 7,
    "a": 60
  },
  "axes": [
    {
      "id": "axis_crank",
      "name": "Manovella",
      "dir": [
        0,
        0,
        1
      ],
      "place": {
        "at": [
          0,
          0,
          0
        ]
      },
      "color": "#ffaa00",
      "parts": [
        {
          "shape": "cylinder",
          "r": 4,
          "w": [
            -12,
            40
          ]
        }
      ]
    },
    {
      "id": "axis_cross",
      "name": "Croce",
      "dir": [
        0,
        0,
        1
      ],
      "place": {
        "at": [
          60,
          0,
          0
        ]
      },
      "color": "#00cc66",
      "parts": [
        {
          "shape": "cylinder",
          "r": 4,
          "w": [
            -12,
            40
          ]
        }
      ]
    }
  ],
  "gears": [
    {
      "id": "gear_driver",
      "name": "Driver",
      "type": "geneva_driver",
      "axis": "axis_crank",
      "color": "#ffaa00",
      "pos": 0,
      "thickness": 6,
    },
    {
      "id": "gear_cross",
      "name": "Croce di Malta",
      "type": "maltese",
      "axis": "axis_cross",
      "slots": 12,
      "slotWidth": 6,
      "pos": 0,
      "thickness": 6,
      "color": "#888888"
    }
  ],
  "links": [
    {
      "type": "geneva",
      "driver": "gear_driver",
      "driven": "gear_cross",
      "slots": 12
    }
  ],
  "inputs": [
    {
      "id": "motore",
      "axis": "axis_crank",
      "label": "Motore"
    }
  ],
  "groups": [],
  "controls": [],
  "variants": {},
  "ratios": [],
  "checks": [],
  "notes": [],
  "views": [
    {
      "id": "all",
      "label": "Insieme",
      "auto": true,
      "alpha": 2.27,
      "beta": 1.1,
      "scale": 1.1
    }
  ]
}