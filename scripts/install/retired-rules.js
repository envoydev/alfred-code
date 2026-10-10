'use strict';
// THE TEXTS THE STACK SHIPPED under each renamed rule's old name - the seven `baseline-*` rules that 2.1.6 renamed to
// `alfred-*`. Each list holds the first 16 hex of the sha256 of every version any commit held (CRLF read as LF), and for
// the docs-root rule also that text stamped with each default root (`.claude/docs`, `.alfred/docs`), as an install wrote
// it. Frozen: a retired name never gets new text. A leftover copy that hashes to one is the stack's, unedited, and goes;
// any other text is a user's edit and stays (`retiredKeep` in alfred-code.js, audit 2026-10-10 C10).
const crypto = require('node:crypto');

const SHIPPED = {
    'baseline-docs-root': '0089ad5c4bff6311 0a27957504ec0976 133c0f3f4ba70604 168f18200c058e4b 17810e87dc7af37f 178cdcd42e9bf1f2 1fd94666a99862fc 20580e8b66acc3da 22f6e69531626016 261dcde666728e53 26b38e42ecce4d43 290e1c7a15140e0d 2c10d3e85dfa6ea3 30700e7f8ef7da11 324ccc332ef34db7 346ec60327553582 361a1a2a57e27436 36657e9b27c9b067 37077efcc64105bf 3868a6c1f933c4cf 3a0caafe47b058f0 3d0d485a37b55ab5 3f7d02c2f13ee494 445cf9631b825820 4699828f16308f3b 47acf2120361ae73 48b3eae14ceec897 4b5b47e9650c5365 52eb245dce54b2ca 60650c50453b218b 614775dee3145004 68e87fd18407d448 69b716b9a20bd3b0 6c358121c0fcd48f 6d1e0a46d30e0a00 7005e5b21fa4a783 74aca52e257774b3 750f35b2357c8526 793f2863a42b0c0f 7960f03dfd303399 7bff02ec42278674 7ded821ad176a04a 80693d2fd9cabbea 80f44b4b54f632fa 82c099f411387718 84edddfcc14e8f1f 878b6cb01efcca0b 900a0b2bb0e060cf 99070b58e7b7662a 99f56b5e13a8ab17 9daee9d54d8770a7 9ddd7a502c7a3ed2 9f890e4e3a20bc0d a458e1fd462b2b78 a45933e204b1eace a613f563ead30a2e a68c1b630a35eba2 a87ae5542f16bbd3 a8fecda22f96e513 ac52a35314dc811a adce60575c2a5720 b003f280fae62db5 b16cb26be8c2f0f5 b17aff617ba9edf0 c222bcc8e422c70a c45da9c0fcdab38a c62f3ada4e1113db d00db44965b66aab d1bdab2e3ee15fd1 d3c400f8c5a0130e d563cb1b2a892621 d815468c0722b9f8 e0b271d4cfd3320b e0dad17ff001303c e2a47c4a1fdeaa9a e2dd0a2a2dbf44a7 e807d8406d586da5 e85dffb55292ccf1 ed569a4ee8dd2a89 f02f1177efb57414 f5d3d3dd4a13caf3 f7406303c2d61e4c f8749a68af4888c5 fe0c9cd0ca11f6b5',
    'baseline-git': '0e5cf41101b23027 2a072fcd1ec1dc2c 4177dd63b1530312 546412033fd1013b 555e46fca9f433ae 5806f72d539b8c54 70ec68eff2a42647 7e79bd833bf18022 82aca627ee1ee195 8c0b24d4b1e94853 ad36a892c7daaff9 b3502f35ee43ffb9 b61894816d2aea2a b6c5608140582b8e b8b9ff2d7bc362b9 d05f5d75772283b5 d7a72b609aab492e dad0b98cf6f30ac2 dc19170cd60dd106 ed2c226c80629ba8 f1cd595daf9a0879 f3075c87385f7531 f326024507598444',
    'baseline-interaction': '158ccde5eeda3921 17bf046f80a65305 191a499ee197e013 1fa941d9f28ce717 32ee3b3b4daf9694 3b21d1f03aedafb4 415cf43943bd4943 45ab9796b8ab8660 5636d8d148ba0249 566f9a5917a40ab0 578f527ea5d44e85 57ced5aa26a8554f 81039755d163108a 8dbcaeaf8fa00730 967be32f5cdb7c9e 9b527fbf88285d51 9ed76bba6b2448c7 ac1c49e8400de8bd adf19427fc32a9e7 af132c615ea0a473 b48be246e73325db b89e2b335a1b2d01 b9330450a5af2371 badb51e255db85d4 bb2e34cfed08c931 bddf7fc6c9b7eec7 df94b708839c57b6 e4ea5d32d8831693 e5ac8bb8066dce18 e798aaf6b2399bbc f747bf7596c99823 fa486a7a2d234ae6',
    'baseline-memory': '1398a66bd31a1fbd 212ea9c1fbb066df 55dca43187af8d88 588a4248f6771c51 5d29f4364f20f63a 8dd57db098f81dd5 c9ee9c6cba37860b ccd590e855a63980 d18eb53fb1791d24 eaef3b8894cb60c1',
    'baseline-navigation': '00ce9a9bfe09e8a4 1317314c030a6f84 24ed61297ef0c79a 3f44dce0b6e15363 40cea6d68d1f3667 45b7a78b4f7a0bbe 4ebbc0a5e6725816 4fbe619d9c5614c9 51375eea12825e4d 603883842e1701c9 6a19d7ee1568874c 6b0afc14a3c95e88 6e3632cbb88e2570 7484383beb8c372f 7a60b6aaf5713eb1 7b5ee15976c722d3 8186993994b6ca8c 8262d893c457b8d0 8581642bb7c658dd a28040167b7f8fca a795c1225126eefc a84c9d0263c5595a a86a05956bee38b6 a93f94513ff7317f b3463d53cd253aa1 b777ccf80f777f82 db797aa90902cf2f dcd833b71faf3e4d ed21892962bbb62d ef73ca55d5ef1471 f443cec553c21317 fcaed96ecf9f48ba',
    'baseline-quality-gates': '087a14a127a27b1b 0f5b46be1ba92358 424ae0cc25dca126 4a9a5b4f3c8982c7 4f0a150d59657ca3 5266ab0dc94fd901 531ca97b0f22fc4c 6122f3c8cb033341 6da036fc431af177 87af6bf6bf2da593 a217ec8124895159 a3d6afc582f2419a a6e7ba702a794e58 b65ffb062edc8e67 c1cdee6acbb9cbe1 ca68062f0ede5b0b cb5530fbd8b88aaa cffaa2b4f5e86443 e5c23206a522a942 f41ad084130b71d0 f491eae5a51ecea5 fc7b40cf14a88fc8 fd5ab8ac10f916bb',
    'baseline-security': '05321b65cd65e98f 0b4ddcc173bfee50 0fc31af6e8acc4ec 16f40eb31e77ab78 2a188212cdb96da2 30df5a29c2546b75 3408f57de733b0c5 36f3cd4daf19bf49 3c4e3041629750b9 467125042af83795 4d3c059a45b9f6d1 50f14a428ad60bc9 514ac774749cdcbe 52bd904f387a0947 52bda9fccdef7a69 539bf51851231c79 7289a990a5c7cb45 7ee2403a1c7baf22 8302d332bfcc6b56 92c65cb785b35f19 a01459fe9069dca4 a45328508d8d442c aa2aa67dde630c1c bd86cf8b3e707978 bfbcf34e9b607d8e c150c851958721e0 ea92d681b7be0066 f1bf6b3709cbcf2b f7e0da468e181d1e',
};

const textHash = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

// True when `text` is, line endings aside, a version the stack shipped as rule `name`.
function shippedText(name, text)
{
    if (typeof text !== 'string' || !Object.hasOwn(SHIPPED, name)) return false;
    return SHIPPED[name].split(' ').includes(textHash(text));
}

module.exports = { shippedText, textHash, RETIRED_RULE_NAMES: Object.keys(SHIPPED) };
