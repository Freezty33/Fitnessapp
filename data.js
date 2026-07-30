// ============================================================
// DATA - extracted from LOUIS.xlsx
// ============================================================

const trainingData = {
  days: {
    1: {
      label: "Jour 1 — Dos / Biceps",
      exercises: [
        { name: "Abdos à la poulie/crunch", tips: "Avec la corde",
          weeks: [
            { series: 3, reps: 15, charge: 55, done: "15×15" },
            { series: 3, reps: 15, charge: 60, done: "15-14-13" },
            { series: 3, reps: 15, charge: 60, done: "15×15×15" },
            { series: 3, reps: 15, charge: 65, done: "" },
            { series: 3, reps: 15, charge: null, done: "" }
          ]
        },
        { name: "Tirage uni horizontal", tips: "Technogym – mouvement semi supination",
          weeks: [
            { series: 3, reps: "7+9", charge: 40, done: "9" },
            { series: 3, reps: "7+9", charge: 40, done: "9" },
            { series: 3, reps: "7+9", charge: 45, done: "9" },
            { series: 3, reps: "7+9", charge: 55, done: "9" },
            { series: 3, reps: "7+9", charge: null, done: "" }
          ]
        },
        { name: "Low Row", tips: "Technogym",
          weeks: [
            { series: 3, reps: "7+9", charge: 22.5, done: "9" },
            { series: 3, reps: "7+9", charge: 30, done: "12" },
            { series: 3, reps: "7+9", charge: 35, done: "9" },
            { series: 3, reps: "7+9", charge: 30, done: "9" },
            { series: 3, reps: "7+9", charge: null, done: "" }
          ]
        },
        { name: "Tirage vertical prise large", tips: "",
          weeks: [
            { series: 3, reps: "8-10", charge: "45/40", done: "8×10×9" },
            { series: 3, reps: "8-10", charge: 45, done: "10-10-9" },
            { series: 3, reps: "8-10", charge: 45, done: "12×10×10" },
            { series: 3, reps: "8-10", charge: "50/47.5", done: "10×10×8" },
            { series: 3, reps: "8-10", charge: null, done: "" }
          ]
        },
        { name: "Curl biceps à la poulie", tips: "Dos à la machine",
          weeks: [
            { series: 3, reps: "10-12", charge: 15, done: "12×12×11" },
            { series: 3, reps: "10-12", charge: 15, done: "12-11-11" },
            { series: 3, reps: "10-12", charge: 15, done: "12×12×12" },
            { series: 3, reps: "10-12", charge: "17.5/15", done: "10×12" },
            { series: 3, reps: "10-12", charge: null, done: "" }
          ]
        },
        { name: "Curl biceps supination sur banc", tips: "Inclinaison 30°",
          weeks: [
            { series: 3, reps: "12-15", charge: 6, done: "15×15" },
            { series: 3, reps: "12-15", charge: 8, done: "15-15-14" },
            { series: 3, reps: "12-15", charge: 8, done: "15×12×14" },
            { series: 3, reps: "12-15", charge: 7, done: "10×13" },
            { series: 3, reps: "12-15", charge: null, done: "" }
          ]
        }
      ]
    },
    2: {
      label: "Jour 2 — Pectoraux / Triceps",
      exercises: [
        { name: "Couché à la smith", tips: "Contrôle excentrique",
          weeks: [
            { series: 3, reps: "6+8", charge: null, done: "" },
            { series: 3, reps: "6+8", charge: "20(17.5)", done: "6" },
            { series: 3, reps: "6+8", charge: 17.5, done: "8" },
            { series: 3, reps: "6+8", charge: 17.5, done: "10" },
            { series: 3, reps: "6+8", charge: 25, done: "6" }
          ]
        },
        { name: "Butterfly", tips: "",
          weeks: [
            { series: 2, reps: "12-15", charge: 10, done: "" },
            { series: 2, reps: "12-15", charge: 12.5, done: "15×15×15" },
            { series: 2, reps: "12-15", charge: 15, done: "15×15×14" },
            { series: 2, reps: "12-15", charge: 15, done: "15×15×12" },
            { series: 2, reps: "12-15", charge: 20, done: "15×15" }
          ]
        },
        { name: "Chestpress classique", tips: "Technogym",
          weeks: [
            { series: 3, reps: "8-10", charge: 35, done: "10" },
            { series: 3, reps: "8-10", charge: 20, done: "7" },
            { series: 3, reps: "8-10", charge: 20, done: "8" },
            { series: 3, reps: "8-10", charge: 20, done: "8" },
            { series: 3, reps: "8-10", charge: 22.5, done: "9" }
          ]
        },
        { name: "Machine à dips", tips: "Amplitude complète",
          weeks: [
            { series: 3, reps: "max", charge: null, done: "6-6-8" },
            { series: 3, reps: "max", charge: null, done: "" },
            { series: 3, reps: "max", charge: null, done: "" },
            { series: 3, reps: "max", charge: null, done: "" },
            { series: 3, reps: "max", charge: 35, done: "12×11×12" }
          ]
        },
        { name: "Extension triceps à la corde", tips: "",
          weeks: [
            { series: 3, reps: "12-15", charge: 10, done: "12-10-9" },
            { series: 3, reps: "12-15", charge: 10, done: "" },
            { series: 3, reps: "12-15", charge: 10, done: "" },
            { series: 3, reps: "12-15", charge: 10, done: "" },
            { series: 3, reps: "12-15", charge: 10, done: "14×15×15" }
          ]
        }
      ]
    },
    3: {
      label: "Jour 3 — Jambes",
      exercises: [
        { name: "Squat smith pieds surélevés", tips: "Beaucoup de temps sous tension – à peine remonté tu repars",
          weeks: [
            { series: 3, reps: "8-10", charge: 20, done: "10" },
            { series: 3, reps: "8-10", charge: 20, done: "" },
            { series: 3, reps: "8-10", charge: 20, done: "" },
            { series: 3, reps: "8-10", charge: 25, done: "" },
            { series: 3, reps: "8-10", charge: null, done: "" }
          ]
        },
        { name: "Fentes bulgares haltères", tips: "Amplitude maximale",
          weeks: [
            { series: 3, reps: "8-10", charge: 3, done: "10×10×10" },
            { series: 3, reps: "8-10", charge: 3, done: "" },
            { series: 3, reps: "8-10", charge: 3, done: "" },
            { series: 3, reps: "8-10", charge: 5, done: "" },
            { series: 3, reps: "8-10", charge: null, done: "" }
          ]
        },
        { name: "Hammer strength presse uni", tips: "",
          weeks: [
            { series: 3, reps: "10-12", charge: 40, done: "12" },
            { series: 3, reps: "10-12", charge: 40, done: "" },
            { series: 3, reps: "10-12", charge: 45, done: "" },
            { series: 3, reps: "10-12", charge: 45, done: "" },
            { series: 3, reps: "10-12", charge: null, done: "" }
          ]
        },
        { name: "Leg Extension", tips: "",
          weeks: [
            { series: 2, reps: "12-15", charge: 25, done: "15" },
            { series: 3, reps: "12-15", charge: 25, done: "" },
            { series: 3, reps: "12-15", charge: 27.5, done: "" },
            { series: 3, reps: "12-15", charge: 27.5, done: "" },
            { series: 3, reps: "12-15", charge: null, done: "" }
          ]
        },
        { name: "Leg curl assis", tips: "",
          weeks: [
            { series: 2, reps: "12-15", charge: null, done: "" },
            { series: 3, reps: "12-15", charge: null, done: "" },
            { series: 3, reps: "12-15", charge: null, done: "" },
            { series: 3, reps: "12-15", charge: null, done: "" },
            { series: 3, reps: "12-15", charge: null, done: "" }
          ]
        }
      ]
    },
    4: {
      label: "Jour 4 — Épaules / Dos",
      exercises: [
        { name: "Incliné smith", tips: "Prise de repères sur la barre",
          weeks: [
            { series: 2, reps: "8-10", charge: 12, done: "" },
            { series: 2, reps: "8-10", charge: 12, done: "" },
            { series: 2, reps: "8-10", charge: 15, done: "" },
            { series: 2, reps: "8-10", charge: 15, done: "" },
            { series: 2, reps: "8-10", charge: null, done: "" }
          ]
        },
        { name: "Couché haltères", tips: "",
          weeks: [
            { series: 2, reps: "8-10", charge: 10, done: "10" },
            { series: 2, reps: "8-10", charge: 10, done: "" },
            { series: 2, reps: "8-10", charge: 12, done: "" },
            { series: 2, reps: "8-10", charge: 12, done: "" },
            { series: 2, reps: "8-10", charge: null, done: "" }
          ]
        },
        { name: "Lat Pulldown", tips: "",
          weeks: [
            { series: 2, reps: "8-10", charge: 50, done: "" },
            { series: 2, reps: "8-10", charge: 50, done: "" },
            { series: 2, reps: "8-10", charge: 55, done: "" },
            { series: 2, reps: "8-10", charge: 55, done: "" },
            { series: 2, reps: "8-10", charge: null, done: "" }
          ]
        },
        { name: "Tractions guidées", tips: "Machine ou avec élastiques",
          weeks: [
            { series: 2, reps: "12-15", charge: 42, done: "10×10×10" },
            { series: 2, reps: "12-15", charge: 42, done: "" },
            { series: 2, reps: "12-15", charge: 45, done: "" },
            { series: 2, reps: "12-15", charge: 45, done: "" },
            { series: 2, reps: "12-15", charge: null, done: "" }
          ]
        },
        { name: "Élévations latérales assis", tips: "",
          weeks: [
            { series: 3, reps: "12-15", charge: 20, done: "12×12×12" },
            { series: 3, reps: "12-15", charge: 20, done: "" },
            { series: 3, reps: "12-15", charge: 22, done: "" },
            { series: 3, reps: "12-15", charge: 22, done: "" },
            { series: 3, reps: "12-15", charge: null, done: "" }
          ]
        },
        { name: "Crunch à la poulie obliques", tips: "",
          weeks: [
            { series: 3, reps: "12-15", charge: 65, done: "15×15×12" },
            { series: 3, reps: "12-15", charge: 65, done: "" },
            { series: 3, reps: "12-15", charge: 70, done: "" },
            { series: 3, reps: "12-15", charge: 70, done: "" },
            { series: 3, reps: "12-15", charge: null, done: "" }
          ]
        }
      ]
    },
    5: {
      label: "Jour 5 — Pectoraux / Triceps (bis)",
      exercises: [
        { name: "Couché à la smith", tips: "Contrôle excentrique",
          weeks: [
            { series: 3, reps: "8-10", charge: 20, done: "10" },
            { series: 3, reps: "8-10", charge: 20, done: "10×9" },
            { series: 3, reps: "8-10", charge: 22, done: "" },
            { series: 3, reps: "8-10", charge: 22, done: "" },
            { series: 3, reps: "8-10", charge: null, done: "" }
          ]
        },
        { name: "Butterfly", tips: "",
          weeks: [
            { series: 2, reps: "12-15", charge: 15, done: "15×15" },
            { series: 2, reps: "12-15", charge: 15, done: "" },
            { series: 2, reps: "12-15", charge: 17.5, done: "" },
            { series: 2, reps: "12-15", charge: 17.5, done: "" },
            { series: 2, reps: "12-15", charge: null, done: "" }
          ]
        },
        { name: "Chestpress classique", tips: "Technogym",
          weeks: [
            { series: 3, reps: "8-10", charge: 20, done: "10×10" },
            { series: 3, reps: "8-10", charge: 20, done: "" },
            { series: 3, reps: "8-10", charge: 22, done: "" },
            { series: 3, reps: "8-10", charge: 22, done: "" },
            { series: 3, reps: "8-10", charge: null, done: "" }
          ]
        },
        { name: "Machine à dips", tips: "",
          weeks: [
            { series: 3, reps: "max", charge: 35, done: "12×11×12" },
            { series: 3, reps: "max", charge: 35, done: "" },
            { series: 3, reps: "max", charge: 37.5, done: "" },
            { series: 3, reps: "max", charge: 37.5, done: "" },
            { series: 3, reps: "max", charge: null, done: "" }
          ]
        },
        { name: "Extension triceps à la corde", tips: "",
          weeks: [
            { series: 3, reps: "12-15", charge: 10, done: "14×15×15" },
            { series: 3, reps: "12-15", charge: 10, done: "" },
            { series: 3, reps: "12-15", charge: 12, done: "" },
            { series: 3, reps: "12-15", charge: 12, done: "" },
            { series: 3, reps: "12-15", charge: null, done: "" }
          ]
        }
      ]
    }
  }
};

const nutritionData = {
  meals: [
    {
      id: 1, type: "PETIT DEJ", icon: "🌅",
      options: [
        {
          label: "Option A",
          items: [
            { food: "Crème de riz", qty: "60g", p: 4, g: 50, l: 0.5, kcal: 220 },
            { food: "Whey", qty: "25g", p: 20, g: 2, l: 1.5, kcal: 100 },
            { food: "Banane", qty: "1", p: 1.3, g: 27, l: 0.3, kcal: 120 },
            { food: "Beurre d'amande", qty: "10g", p: 2.1, g: 1.9, l: 5.5, kcal: 61 }
          ]
        },
        {
          label: "Option B",
          items: [
            { food: "Smoothie Whey+Avoine+Lait végétal+Pomme", qty: "1 portion", p: 35, g: 60, l: 5.8, kcal: 435 }
          ]
        },
        {
          label: "Option C",
          items: [
            { food: "Pancakes avoine+whey", qty: "60g+20g", p: 24, g: 38, l: 5.4, kcal: 308 },
            { food: "Yaourt grec", qty: "100g", p: 10, g: 3.5, l: 0.4, kcal: 59 },
            { food: "Kiwi", qty: "2", p: 1.6, g: 22, l: 0.8, kcal: 92 }
          ]
        }
      ]
    },
    {
      id: 2, type: "COLLATION 1", icon: "🍎",
      options: [
        {
          label: "Option A",
          items: [
            { food: "Fromage blanc", qty: "200g", p: 16, g: 8, l: 0.4, kcal: 90 },
            { food: "Pomme", qty: "1", p: 0.4, g: 21, l: 0.2, kcal: 78 },
            { food: "Amandes", qty: "20g", p: 4.2, g: 4.4, l: 10, kcal: 116 }
          ]
        },
        {
          label: "Option B",
          items: [
            { food: "Whey", qty: "30g", p: 24, g: 2.5, l: 1.8, kcal: 120 },
            { food: "Pain complet", qty: "2 tranches", p: 6, g: 28, l: 1.8, kcal: 148 },
            { food: "Confiture", qty: "15g", p: 0, g: 9.5, l: 0, kcal: 38 }
          ]
        },
        {
          label: "Option C",
          items: [
            { food: "Skyr", qty: "170g", p: 18, g: 6, l: 0.3, kcal: 102 },
            { food: "Flocons d'avoine", qty: "30g", p: 3.8, g: 21, l: 2.1, kcal: 114 },
            { food: "Fruits rouges", qty: "50g", p: 0.5, g: 6, l: 0.2, kcal: 25 }
          ]
        }
      ]
    },
    {
      id: 3, type: "DÉJEUNER", icon: "🍽️",
      options: [
        {
          label: "Option A – Poulet",
          items: [
            { food: "Poulet", qty: "120g", p: 27.6, g: 0, l: 1.5, kcal: 132 },
            { food: "Riz basmati cru", qty: "70g", p: 5.6, g: 55, l: 5.7, kcal: 245 },
            { food: "Courgettes + carottes", qty: "à volonté", p: 0, g: 0, l: 0, kcal: 0 },
            { food: "Huile d'olive", qty: "10mL", p: 0, g: 0, l: 10, kcal: 90 }
          ]
        },
        {
          label: "Option B – Boeuf",
          items: [
            { food: "Boeuf 5%", qty: "120g", p: 25, g: 0, l: 6, kcal: 165 },
            { food: "Pâtes complètes crues", qty: "70g", p: 9, g: 49, l: 1.9, kcal: 245 },
            { food: "Légumes verts", qty: "à volonté", p: 0, g: 0, l: 0, kcal: 0 },
            { food: "Parmesan", qty: "10g", p: 3.6, g: 0, l: 2.8, kcal: 40 }
          ]
        }
      ]
    },
    {
      id: 4, type: "COLLATION 2", icon: "🥤",
      options: [
        {
          label: "Option A",
          items: [
            { food: "Crème de riz", qty: "40g", p: 2.7, g: 33, l: 0.3, kcal: 147 },
            { food: "Whey", qty: "25g", p: 20, g: 2, l: 1.5, kcal: 100 },
            { food: "Fruits rouges", qty: "50g", p: 0.5, g: 6, l: 0.2, kcal: 25 }
          ]
        },
        {
          label: "Option B",
          items: [
            { food: "Fromage blanc", qty: "200g", p: 16, g: 8, l: 0.4, kcal: 90 },
            { food: "Miel", qty: "15g", p: 0, g: 12, l: 0, kcal: 46 },
            { food: "Avoine", qty: "20g", p: 2.6, g: 12, l: 1.4, kcal: 76 }
          ]
        },
        {
          label: "Option C",
          items: [
            { food: "Whey", qty: "25g", p: 20, g: 2, l: 1.5, kcal: 100 },
            { food: "Banane", qty: "1", p: 1.3, g: 27, l: 0.3, kcal: 120 },
            { food: "Amandes", qty: "10g", p: 2.1, g: 2.2, l: 5, kcal: 58 }
          ]
        }
      ]
    },
    {
      id: 5, type: "DÎNER", icon: "🌙",
      options: [
        {
          label: "Option A – Poulet",
          items: [
            { food: "Poulet", qty: "120g", p: 27.6, g: 0, l: 1.5, kcal: 132 },
            { food: "Pommes de terre", qty: "200g", p: 4, g: 34, l: 0.2, kcal: 154 },
            { food: "Légumes verts", qty: "à volonté", p: 0, g: 0, l: 0, kcal: 0 },
            { food: "Huile d'olive", qty: "10mL", p: 0, g: 0, l: 10, kcal: 90 }
          ]
        },
        {
          label: "Option B – Saumon",
          items: [
            { food: "Saumon", qty: "120g", p: 24, g: 0, l: 12, kcal: 212 },
            { food: "Riz complet", qty: "60g cru", p: 4.2, g: 44, l: 1, kcal: 204 },
            { food: "Brocolis", qty: "à volonté", p: 0, g: 0, l: 0, kcal: 0 }
          ]
        }
      ]
    }
  ]
};

const progressData = {
  weeks: [1, 2, 3, 4],
  poids: [100, 95, 90, 85],
  graisse: [35, 32, 31, 25],
  eau: [67, 70, 73, 76],
  muscle: [50, 55, 60, 62]
};

// exercise charge progression per week (kg)
const exerciseProgress = {
  "Abdos à la poulie/crunch": [55, 60, 60, 65, null],
  "Tirage uni horizontal": [40, 40, 45, 55, null],
  "Low Row": [22.5, 30, 35, 30, null],
  "Tirage vertical prise large": [45, 45, 45, 50, null],
  "Curl biceps à la poulie": [15, 15, 15, 17.5, null],
  "Curl biceps supination sur banc": [6, 8, 8, 7, null],
  "Couché à la smith": [null, 17.5, 17.5, 17.5, 25],
  "Butterfly": [10, 12.5, 15, 15, 20],
  "Chestpress classique": [35, 20, 20, 20, 22.5],
  "Machine à dips": [null, null, null, null, 35],
  "Extension triceps à la corde": [10, 10, 10, 10, 10],
  "Squat smith pieds surélevés": [20, 20, 20, 25, null],
  "Fentes bulgares haltères": [3, 3, 3, 5, null],
  "Leg Extension": [25, 25, 27.5, 27.5, null],
  "Leg curl assis": [null, null, null, null, null],
  "Incliné smith": [12, 12, 15, 15, null],
  "Lat Pulldown": [50, 50, 55, 55, null],
  "Tractions guidées": [42, 42, 45, 45, null],
  "Élévations latérales assis": [20, 20, 22, 22, null]
};
