/* SPDX-License-Identifier: MIT — Copyright (c) 2026 Juan Antonio Castillo (jachguate). See LICENSE. */
/*
  Site configuration.

  sourceUrl is printed on every generated sheet (PDF, PNG and SVG) and linked
  from the page footer. Change it once the page is published (a short URL is
  fine); sourceLabel is the text actually printed, usually the URL without the
  protocol.
*/
(function (global) {
  'use strict';
  const HT = global.HabitTracker = global.HabitTracker || {};

  HT.config = {
    sourceUrl: 'https://github.com/jachguate/habit-tracker',
    sourceLabel: 'github.com/jachguate/habit-tracker',
  };
})(window);
