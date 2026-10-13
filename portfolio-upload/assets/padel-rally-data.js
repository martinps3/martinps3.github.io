(function (root) {
  "use strict";

  // Hand-marked floor-contact estimates on 500 x 281.25 reference frames.
  // Source excerpt: 60.5-75.5 s. Rows are spaced 0.5 s apart.
  const corners = [[146.5, 82.4], [352.3, 82.4], [440.2, 240.2], [59.8, 240.2]];
  const marks = [
    [[140,217],[332,213],[263,89],[286,110]],
    [[139,218],[330,211],[260,89],[284,111]],
    [[140,222],[333,211],[252,94],[282,111]],
    [[165,223],[332,214],[238,98],[276,114]],
    [[200,226],[331,215],[223,102],[281,113]],
    [[216,230],[338,209],[211,111],[281,112]],
    [[181,230],[336,219],[202,111],[282,113]],
    [[178,230],[326,216],[195,111],[278,112]],
    [[181,230],[330,216],[204,112],[281,112]],
    [[170,225],[341,213],[212,110],[280,110]],
    [[178,224],[354,210],[220,109],[282,111]],
    [[181,221],[357,216],[226,111],[289,111]],
    [[165,216],[347,215],[222,109],[290,108]],
    [[196,220],[306,219],[221,108],[291,109]],
    [[232,219],[299,220],[222,109],[289,110]],
    [[235,225],[321,210],[219,112],[289,112]],
    [[208,225],[347,195],[215,112],[293,97]],
    [[190,208],[368,176],[215,111],[293,90]],
    [[173,187],[376,157],[213,111],[296,93]],
    [[177,170],[355,139],[214,112],[304,95]],
    [[211,178],[345,140],[219,111],[312,98]],
    [[252,196],[340,150],[219,114],[304,112]],
    [[267,225],[322,165],[224,113],[285,114]],
    [[228,225],[275,175],[214,112],[271,111]],
    [[187,220],[205,160],[200,111],[275,110]],
    [[191,191],[154,167],[183,110],[270,110]],
    [[218,177],[146,157],[174,111],[273,110]],
    [[248,166],[154,153],[174,107],[263,94]],
    [[280,157],[192,155],[178,108],[270,92]],
    [[293,151],[207,152],[184,105],[289,90]],
    [[307,146],[234,155],[191,103],[299,92]]
  ];
  const secondMarks = [
    [[196,204],[380,221],[206,90],[303,112]],
    [[191,205],[318,226],[213,104],[296,112]],
    [[156,211],[319,221],[218,111],[305,111]],
    [[174,216],[384,223],[230,112],[315,114]],
    [[164,206],[367,209],[237,108],[309,110]],
    [[192,213],[329,211],[211,109],[288,111]],
    [[168,218],[328,212],[208,113],[284,112]],
    [[204,224],[296,222],[213,113],[286,112]],
    [[180,226],[331,211],[227,112],[286,112]],
    [[252,229],[330,209],[224,112],[287,112]],
    [[232,228],[329,169],[190,100],[287,111]],
    [[246,222],[331,145],[165,96],[282,111]],
    [[267,222],[353,160],[197,110],[292,114]],
    [[229,211],[325,186],[210,107],[293,104]],
    [[157,189],[284,192],[211,111],[320,94]],
    [[145,212],[295,198],[207,111],[303,96]],
    [[172,236],[334,185],[215,105],[271,104]]
  ];
  const thirdMarks = [
    [[195,203],[380,219],[206,94],[303,112]],
    [[193,199],[391,233],[218,102],[299,112]],
    [[175,207],[379,232],[226,111],[312,112]],
    [[117,209],[324,212],[210,113],[296,112]],
    [[133,219],[319,213],[190,112],[276,111]],
    [[134,225],[330,198],[193,111],[275,109]],
    [[156,204],[310,179],[197,109],[294,92]],
    [[179,187],[299,166],[216,105],[300,87]]
  ];
  const calibration = corners.map(([x, y]) => [x / 500, y / 281.25]);
  const transform = root.Padel.calibrate(calibration);
  function rally(id, title, start, duration, samples, step, moments) {
    return {
      id, title, start, duration, moments,
      video: "assets/padel-" + id + ".mp4",
      version: 1,
      source: "manual",
      players: ["Stupaczuk", "Sanz", "Coello", "Tapia"],
      calibration,
      frames: samples.map((players, i) => ({
        t: i * step,
        positions: players.map(([x, y]) => root.Padel.project(transform.toCourt, [x / 500, y / 281.25]))
      }))
    };
  }
  root.PadelMatch = root.Padel.validateMatch({
    duration: 2431.80263,
    rallies: [
      rally("changing-sides", "From defense to the net", 60.5, 15, marks, 0.5, [
        { time: 2.5, label: "Baseline recovery", description: "Stupaczuk recovers across the back of the court." },
        { time: 8, label: "Move forward", description: "The near-side pair starts moving forward from the baseline." },
        { time: 12, label: "Switch sides", description: "Follow Sanz across the court as the near-side players exchange positions." }
      ]),
      rally("deep-court-pressure", "Under deep-court pressure", 80, 16, secondMarks, 1, [
        { time: 3, label: "Corner retrieval", description: "Sanz reaches into the near-right corner to keep the exchange going." },
        { time: 7, label: "Central recovery", description: "Stupaczuk works back toward the middle while both opponents hold their positions." },
        { time: 11, label: "Split positions", description: "Sanz advances while Stupaczuk stays deep, creating a large gap between the pair." }
      ]),
      rally("short-exchange", "A short defensive exchange", 126, 7, thirdMarks, 1, [
        { time: 1, label: "Back-corner defense", description: "Sanz tracks the ball deep into the near-right corner." },
        { time: 4, label: "Defensive split", description: "Both near-side players reset behind the service line." },
        { time: 6, label: "Moving up", description: "The near-side pair moves forward near the end of this excerpt." }
      ])
    ]
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
