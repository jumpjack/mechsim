{
  "title": "Scappamento a pendolo (Graham)",
  "consts" : {
    "module" : 1,
  },
  "controls": [
    {
      "id": "pendulumLength",
      "label": "Lunghezza pendolo",
      "step": 1,
      "ranges": {
        "all": { "min": 40, "max": 220, "value": 160 }
      }
    },
    {
      "id": "frictionVal",
      "label": "Attrito",
      "step": 0.005,
      "ranges": {
        "all": { "min": 0.001, "max": 0.5, "value": 0.03 }
      }
    },
    {
      "id": "amplitude",
      "label": "Ampiezza target (°)",
      "step": 0.5,
      "ranges": {
        "all": { "min": 3, "max": 15, "value": 6 }
      }
    },
    {
      "id": "timeScale",
      "label": "Rallentatore",
      "step": 0.05,
      "ranges": {
        "all": { "min": 0.05, "max": 2, "value": 1 }
      }
    }
  ],
  "axes": [
    {
      "id": "esc",
      "name": "Ruota scappamento",
      "dir": [0, 0, 1],
      "place": { "at": [0, 0, 0] },
      "color": "#8899aa",
      "parts": [
        { "shape": "cylinder", "r": 2, "w": [-8, 8] , "n" : 6}
      ]
    },
    {
      "id": "anc",
      "name": "Ancora / pendolo",
      "dir": [0, 0, 1],
      "place": { "at": [0, 56, 0] },
      "color": "#66ccff",
      "parts": [
        { "shape": "cylinder", "r": 2, "w": [-6, 6], "n" : 6 }
      ]
    },
    {
      "id": "axis_New",
      "name": "new",
      "dir": [0, 0, 1],
      "place": { "at": [0, 75, 0] },
      "color": "#ddddff",
      "parts": [
        { "shape": "cylinder", "r": 4, "w": [-116, 116], "n" : 6 }
      ]
    },
    {
      "id": "axis_New2",
      "name": "new",
      "dir": [0, 0, 1],
      "place": { "at": [0, 125, 0] },
      "color": "#ddddff",
      "parts": [
        { "shape": "cylinder", "r": 4, "w": [-116, 116], "n" : 6 }
      ]
    }
    
    
  ],
  "gears": [
    {
      "id": "wheel",
      "name": "Ruota scappamento",
      "axis": "esc",
      "type": "escapement",
      "teeth": 30,
      "r": 30,
      "w": [-3, 3],
      "color": "#ffcc00",
      "label": "E"
    },
    {
      "id": "ancora",
      "name": "Ancora",
      "axis": "anc",
      "type": "anchor",
      "span": 90,
      "armLen": 38,
      "palletW": 12,
      "palletH": 9,
      "pendulumLength": "pendulumLength",
      "bobR": 14,
      "relPos": "auto",
      "w": [-2, 2],
      "color": "#66ccff",
      "label": "A"
    },
    {
      "id": "gear_A",
      "name": "gear_A",
      "axis": "esc",
      "type": "spur",
      "module" : "module",
      "teeth" : 100,
      "pos": -20,
      "thickness": 6,
      "color": "#ff0000",
      "label": "A",
      "free" : false
    },
    {
      "id": "gear_B",
      "name": "gear_B",
      "axis": "axis_New",
      "type": "spur",
      "module" : "module",
      "teeth" : 50,
      "pos": -20,
      "thickness": 6,
      "color": "#ff00ff",
      "label": "A",
      "free" : false,
      "meshWith" : "gear_A"
    },
    {
      "id": "gear_C",
      "name": "gear_C",
      "axis": "axis_New2",
      "type": "spur",
      "module" : "module",
      "teeth" : 50,
      "pos": -20,
      "thickness": 6,
      "color": "#ff55ff",
      "label": "A",
      "free" : false,
      "meshWith" : "gear_B"
    }
    
  ],
  "links": [
    {
      "type": "anchor_escapement",
      "driver": "wheel",
      "driven": "ancora",
      "friction": "frictionVal",
      "amplitude": "amplitude"
    }
  ],
  "inputs": [
    {
      "id": "ruota",
      "axis": "esc",
      "label": "Ruota (clicca per avviare)"
    }
  ],
  "views": [
    {
      "id": "all",
      "label": "Insieme",
      "auto": true,
      "alpha": 1.2,
      "beta": 1.0,
      "scale": 1.3
    }
  ]
}
