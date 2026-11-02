{
  "title": "3 assi + 2 ingranaggi con bore tondo e D",
  "axes": [
      {"id": "asse_pieno",
      "name": "pieno",
      "dir": [0,1,0], "place": {"at": [0,0,0]},
      "hold": true,
      "color": "#ff0000",
      "parts": [{"shape": "cylinder", "r": 2, "w": [0,50], "n": 32}]
    },
      {"id": "asse_cavo",
      "name": "cavo",
      "dir": [0,1,0], "place": {"at": [80,0,0]},
      "hold": true,
      "color": "#ffff00",
      "parts": [{"shape": "cylinder", "r": 6, "w": [0,100], "n": 32, "hollow": 2}]
    },
      {"id": "asse_D",
      "name": "D",
      "dir": [0,1,0], "place": {"at": [30,0,0]},
      "hold": true,
      "color": "#0000ff",
      "parts": [{"shape": "cylinder", "r": 2, "w": [0,100], "n": 48, "flat": {"depth": 1, "angle": 90}}]
    }
  ],
  "gears": [
      {"id": "gear_tondo",
      "name": "20 denti - foro tondo",
      "axis": "asse_pieno",
      "type": "spur",
      "teeth": 20,
      "module": 1,
      "w": [0,20],
      "color": "#ffaaaa",
      "bore": 2.2,
      "flat": false,
      "angle": 0
    },
      {"id": "gear_D",
      "name": "40 denti - foro a D",
      "axis": "asse_D",
      "type": "spur",
      "teeth": 40,
      "module": 1,
      "w": [0,20],
      "color": "#aaaaff",
      "meshWith": "gear_tondo",
      "bore": 2.2,
      "flat": 0.6,
      "flatAngle": 180,
      "angle": 0
    }
  ],
  "links": [],
  "views": [{"id": "all", "label": "Insieme", "auto": true, "alpha": 2.27, "beta": 1.1, "scale": 1.1}]
}