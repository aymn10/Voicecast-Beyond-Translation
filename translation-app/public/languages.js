/* Shared language catalog: add new languages here. */

window.VC = (function () {
  var raw = [["en", "en-US", "English", "English", 0], ["es", "es-ES", "Spanish", "Espa\u00f1ol", 0], ["fr", "fr-FR", "French", "Fran\u00e7ais", 0], ["de", "de-DE", "German", "Deutsch", 0], ["it", "it-IT", "Italian", "Italiano", 0], ["pt", "pt-BR", "Portuguese", "Portugu\u00eas", 0], ["nl", "nl-NL", "Dutch", "Nederlands", 0], ["pl", "pl-PL", "Polish", "Polski", 0], ["ru", "ru-RU", "Russian", "\u0420\u0443\u0441\u0441\u043a\u0438\u0439", 0], ["tr", "tr-TR", "Turkish", "T\u00fcrk\u00e7e", 0], ["ar", "ar-SA", "Arabic", "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", 1], ["hi", "hi-IN", "Hindi", "\u0939\u093f\u0928\u094d\u0926\u0940", 0], ["mr", "mr-IN", "Marathi", "\u092e\u0930\u093e\u0920\u0940", 0], ["bn", "bn-IN", "Bengali", "\u09ac\u09be\u0982\u09b2\u09be", 0], ["ta", "ta-IN", "Tamil", "\u0ba4\u0bae\u0bbf\u0bb4\u0bcd", 0], ["te", "te-IN", "Telugu", "\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41", 0], ["gu", "gu-IN", "Gujarati", "\u0a97\u0ac1\u0a9c\u0ab0\u0abe\u0aa4\u0ac0", 0], ["kn", "kn-IN", "Kannada", "\u0c95\u0ca8\u0ccd\u0ca8\u0ca1", 0], ["ml", "ml-IN", "Malayalam", "\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02", 0], ["pa", "pa-Guru-IN", "Punjabi", "\u0a2a\u0a70\u0a1c\u0a3e\u0a2c\u0a40", 0], ["ur", "ur-IN", "Urdu", "\u0627\u0631\u062f\u0648", 1], ["ja", "ja-JP", "Japanese", "\u65e5\u672c\u8a9e", 0], ["ko", "ko-KR", "Korean", "\ud55c\uad6d\uc5b4", 0], ["zh", "zh-CN", "Chinese", "\u4e2d\u6587", 0], ["id", "id-ID", "Indonesian", "Bahasa Indonesia", 0], ["vi", "vi-VN", "Vietnamese", "Ti\u1ebfng Vi\u1ec7t", 0], ["th", "th-TH", "Thai", "\u0e44\u0e17\u0e22", 0]];
  var list = raw.map(function (r) { return { c: r[0], s: r[1], n: r[2], x: r[3], rtl: !!r[4] }; });
  function label(l) { return l.n === l.x ? l.n : l.n + ' \u00b7 ' + l.x; }
  var names = {}, speech = {}, native = {}, rtl = {};
  list.forEach(function (l) { names[l.c] = l.n; speech[l.c] = l.s; native[l.c] = l.x; if (l.rtl) rtl[l.c] = true; });
  return {
    list: list, names: names, speech: speech, native: native, rtl: rtl, label: label,
    speechList: list.map(function (l) { return [l.s, l.n]; }),
    textList: list.map(function (l) { return [l.s, label(l)]; }),
    docList: list.map(function (l) { return [l.c, label(l)]; })
  };
})();
