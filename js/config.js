/* SPDX-License-Identifier: MIT — Copyright (c) 2026 Juan Antonio Castillo (jachguate). See LICENSE. */
/*
  Site configuration.

  sourceUrl is printed on every generated sheet (PDF, PNG and SVG) and is the
  target of its link; sourceLabel is the text actually printed, usually the
  URL without the protocol.
*/
(function (global) {
  'use strict';
  const HT = global.HabitTracker = global.HabitTracker || {};

  HT.config = {
    sourceUrl: 'https://tinyurl.com/radial-habits',
    sourceLabel: 'tinyurl.com/radial-habits',
  };
})(window);
