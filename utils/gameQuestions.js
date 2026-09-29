// MatchHala - بنوك أسئلة ألعاب المحادثة
// المستوى الخفيف فقط. لا محتوى جنسي، ولا طلب صورة شخصية أو بيانات اتصال
// (تصطدم بسياسة الترويج الخارجي). كل عنصر ثنائي اللغة {ar, en}.
// المعرّف = الفهرس في المصفوفة → لا تُعِد ترتيب العناصر بعد النشر، أضف في النهاية.

const TRUTHS = [
    { ar: 'ما أكثر شيء تخجل منه لكنه يضحكك الآن؟', en: 'What is something embarrassing that now makes you laugh?' },
    { ar: 'ما آخر كذبة بيضاء قلتها؟', en: 'What was the last white lie you told?' },
    { ar: 'ما أغرب عادة عندك لا يعرفها أحد؟', en: 'What is your weirdest habit nobody knows about?' },
    { ar: 'ما أول شيء تلاحظه في شخص تقابله لأول مرة؟', en: 'What is the first thing you notice about someone new?' },
    { ar: 'ما أكثر موقف محرج مرّ عليك أمام الناس؟', en: 'What is your most embarrassing moment in public?' },
    { ar: 'لو تقدر تسافر الآن لأي مكان، أين تذهب ومع من؟', en: 'If you could travel anywhere now, where and with whom?' },
    { ar: 'ما الشيء الذي تتمنى لو أخبرك به أحد قبل سنوات؟', en: 'What do you wish someone had told you years ago?' },
    { ar: 'ما أكثر شيء تخاف منه ولا تعترف به؟', en: 'What is something you fear but rarely admit?' },
    { ar: 'ما الأغنية التي تسمعها سراً ولا تعترف بها؟', en: 'What is your guilty-pleasure song?' },
    { ar: 'ما أجمل مجاملة سمعتها في حياتك؟', en: 'What is the nicest compliment you have ever received?' },
    { ar: 'ما الصفة التي تتمناها في شريك حياتك ولا تتنازل عنها؟', en: 'Which trait in a partner is a must for you?' },
    { ar: 'ما أكثر قرار ندمت عليه؟', en: 'Which decision do you regret the most?' },
    { ar: 'هل سبق أن حضرت موعداً وتمنيت أن ينتهي بسرعة؟ احكِ ما حدث.', en: 'Have you been on a date you wanted to end fast? What happened?' },
    { ar: 'ما الشيء الذي تفعله حين تكون وحدك ولا تفعله أمام أحد؟', en: 'What do you do when alone that you never do in front of others?' },
    { ar: 'ما أول انطباع تظن أني أخذته عنك؟', en: 'What first impression do you think I got of you?' },
    { ar: 'ما أحلامك التي لم تخبر بها أحداً؟', en: 'What dream have you never told anyone about?' },
    { ar: 'ما أكثر شيء يجعلك تغضب بسرعة؟', en: 'What makes you angry the fastest?' },
    { ar: 'ما أطرف لقب ناداك به أحد؟', en: 'What is the funniest nickname anyone gave you?' },
    { ar: 'ما الهدية التي لن تنساها أبداً؟', en: 'What gift will you never forget?' },
    { ar: 'لو عاد بك الزمن يوماً واحداً، أي يوم تختار؟', en: 'If you could relive one day, which would it be?' },
    { ar: 'ما أكثر شيء تحبه في نفسك؟ وما أكثر شيء تتمنى تغييره؟', en: 'What do you like most about yourself, and what would you change?' },
    { ar: 'ما الفيلم أو المسلسل الذي بكيت فيه؟', en: 'Which movie or show made you cry?' },
    { ar: 'ما أسوأ نصيحة أخذتها في حياتك؟', en: 'What is the worst advice you have ever taken?' },
    { ar: 'ما الشيء الصغير الذي يجعل يومك أفضل؟', en: 'What small thing makes your day better?' },
    { ar: 'ما أكثر موقف شعرت فيه بالفخر بنفسك؟', en: 'When did you feel most proud of yourself?' }
];

const DARES = [
    { ar: 'سجّل رسالة صوتية تغنّي فيها مقطعاً من أغنية تحبها.', en: 'Send a voice message singing a line from a song you like.' },
    { ar: 'سجّل رسالة صوتية تقلّد فيها صوت حيوان.', en: 'Send a voice message imitating an animal.' },
    { ar: 'صوّر شيئاً أمامك الآن وأرسله، وعلينا أن نخمّن قصته.', en: 'Snap something in front of you and send it — we guess its story.' },
    { ar: 'اكتب قصة من ثلاث جمل عن مغامرتنا لو سافرنا معاً.', en: 'Write a three-sentence story about a trip we take together.' },
    { ar: 'أرسل ثلاثة إيموجي فقط تصف بها يومك، وعلينا أن نفسّرها.', en: 'Describe your day with only three emojis.' },
    { ar: 'سجّل رسالة صوتية تقول فيها «مرحباً» بخمس لهجات مختلفة.', en: 'Send a voice message saying "hello" in five different accents.' },
    { ar: 'اكتب أطرف نكتة تحفظها.', en: 'Write the funniest joke you know.' },
    { ar: 'صف نفسك بثلاث كلمات فقط، دون ذكر مظهرك.', en: 'Describe yourself in three words, not counting looks.' },
    { ar: 'سجّل رسالة صوتية تقرأ فيها آخر رسالة وصلتك من أحد بصوت درامي (دون ذكر الأسماء).', en: 'Read the last message you received in a dramatic voice (no names).' },
    { ar: 'أرسل صورة لأقرب كوب أو مشروب عندك.', en: 'Send a photo of the nearest drink or cup.' },
    { ar: 'اختر لنا أغنية نسمعها الآن معاً وقل لماذا اخترتها.', en: 'Pick a song for us to listen to now and say why.' },
    { ar: 'اكتب رسالة من سطرين كأنك بطل فيلم رومانسي قديم.', en: 'Write a two-line message as if you were a classic movie hero.' },
    { ar: 'تحدَّ نفسك: قل ثلاث مرات بسرعة «شيخ شايخ شاخ شيخوخة».', en: 'Say a tongue twister three times fast in a voice message.' },
    { ar: 'أرسل صورة لأجمل منظر يمكنك رؤيته من مكانك الآن.', en: 'Send a photo of the nicest view you can see right now.' },
    { ar: 'اروِ لنا ذكرى طفولة سعيدة في رسالة صوتية قصيرة.', en: 'Tell a happy childhood memory in a short voice message.' },
    { ar: 'اخترع اسماً لتطبيق جديد واشرح فكرته بجملتين.', en: 'Invent a new app name and explain it in two sentences.' },
    { ar: 'سجّل رسالة صوتية بأسلوب مذيع نشرة أخبار تعلن فيها عن يومك.', en: 'Announce your day like a news anchor in a voice message.' },
    { ar: 'ارسم شيئاً بسيطاً على ورقة وأرسل صورته.', en: 'Draw something simple on paper and send a photo.' },
    { ar: 'أرسل أول إيموجي يخطر ببالك عن كل واحد منا.', en: 'Send the first emoji that comes to mind for each of us.' },
    { ar: 'قل لنا ثلاثة أشياء تشكر الله عليها اليوم.', en: 'Tell us three things you are grateful for today.' }
];

// هل تفضّل؟ — a/b بلغتين
const WOULD_YOU_RATHER = [
    { a: { ar: 'السفر إلى الماضي', en: 'Travel to the past' }, b: { ar: 'السفر إلى المستقبل', en: 'Travel to the future' } },
    { a: { ar: 'الجبل والهدوء', en: 'Mountains and quiet' }, b: { ar: 'البحر والشاطئ', en: 'Sea and beach' } },
    { a: { ar: 'سهر الليل', en: 'Night owl' }, b: { ar: 'صحو الفجر', en: 'Early bird' } },
    { a: { ar: 'قراءة أفكار الناس', en: 'Read minds' }, b: { ar: 'الطيران', en: 'Fly' } },
    { a: { ar: 'أن تعيش في مدينة صاخبة', en: 'Live in a busy city' }, b: { ar: 'أن تعيش في قرية هادئة', en: 'Live in a quiet village' } },
    { a: { ar: 'قهوة', en: 'Coffee' }, b: { ar: 'شاي', en: 'Tea' } },
    { a: { ar: 'رحلة مخطط لها بالتفصيل', en: 'A fully planned trip' }, b: { ar: 'رحلة عفوية بلا خطة', en: 'A spontaneous trip' } },
    { a: { ar: 'مطعم فاخر', en: 'Fancy restaurant' }, b: { ar: 'طبخ منزلي مع من تحب', en: 'Home cooking with loved ones' } },
    { a: { ar: 'أن تعرف موعد وفاتك', en: 'Know when you will die' }, b: { ar: 'أن تعرف سببها', en: 'Know how you will die' } },
    { a: { ar: 'فيلم في السينما', en: 'A movie at the cinema' }, b: { ar: 'فيلم في البيت مع بطانية', en: 'A movie at home under a blanket' } },
    { a: { ar: 'مال كثير وعمل تكرهه', en: 'A lot of money and a job you hate' }, b: { ar: 'مال أقل وعمل تحبه', en: 'Less money and a job you love' } },
    { a: { ar: 'الصراحة المؤلمة', en: 'Hurtful honesty' }, b: { ar: 'الكذبة الجميلة', en: 'A pretty lie' } },
    { a: { ar: 'أن تتحدث كل اللغات', en: 'Speak every language' }, b: { ar: 'أن تعزف كل الآلات', en: 'Play every instrument' } },
    { a: { ar: 'الشتاء', en: 'Winter' }, b: { ar: 'الصيف', en: 'Summer' } },
    { a: { ar: 'حيوان أليف كلب', en: 'A pet dog' }, b: { ar: 'حيوان أليف قطة', en: 'A pet cat' } },
    { a: { ar: 'هدية مفاجئة', en: 'A surprise gift' }, b: { ar: 'هدية تختارها بنفسك', en: 'A gift you choose yourself' } },
    { a: { ar: 'أن تكون مشهوراً', en: 'Be famous' }, b: { ar: 'أن تكون مجهولاً وسعيداً', en: 'Be unknown and happy' } },
    { a: { ar: 'موعد عشاء هادئ', en: 'A quiet dinner date' }, b: { ar: 'موعد مغامرة وأنشطة', en: 'An adventurous activity date' } },
    { a: { ar: 'أن تُنسى أخطاؤك', en: 'Have your mistakes forgotten' }, b: { ar: 'أن تُحفظ إنجازاتك', en: 'Have your achievements remembered' } },
    { a: { ar: 'رسائل نصية طويلة', en: 'Long text messages' }, b: { ar: 'رسائل صوتية', en: 'Voice messages' } },
    { a: { ar: 'يوم بلا هاتف', en: 'A day with no phone' }, b: { ar: 'يوم بلا موسيقى', en: 'A day with no music' } },
    { a: { ar: 'حلو', en: 'Sweet' }, b: { ar: 'مالح', en: 'Salty' } },
    { a: { ar: 'أن تعيش بلا إنترنت', en: 'Live without the internet' }, b: { ar: 'أن تعيش بلا سيارة', en: 'Live without a car' } },
    { a: { ar: 'مفاجأة عيد ميلاد كبيرة', en: 'A big birthday surprise' }, b: { ar: 'يوم هادئ مع أقرب الناس', en: 'A quiet day with your closest people' } },
    { a: { ar: 'العودة للطفولة يوماً', en: 'Be a kid again for a day' }, b: { ar: 'رؤية نفسك بعد 20 سنة', en: 'See yourself 20 years from now' } }
];

// لم أفعل قط — عبارات خفيفة. «فعلتها» / «لم أفعلها» يُكشفان معاً.
const NEVER_HAVE_I_EVER = [
    { ar: 'لم أسافر وحدي قط', en: 'I have never traveled alone' },
    { ar: 'لم أنسَ موعداً مهماً قط', en: 'I have never forgotten an important appointment' },
    { ar: 'لم أضحك في موقف لا يجوز الضحك فيه قط', en: 'I have never laughed at a moment I should not have' },
    { ar: 'لم أتأخر عن موعد بسبب النوم قط', en: 'I have never been late because I overslept' },
    { ar: 'لم أغنِّ بصوت عالٍ في السيارة قط', en: 'I have never sung loudly in the car' },
    { ar: 'لم أشاهد مسلسلاً كاملاً في يوم واحد قط', en: 'I have never binged a whole series in one day' },
    { ar: 'لم أتظاهر بأني أعرف شيئاً وأنا لا أعرفه قط', en: 'I have never pretended to know something I did not' },
    { ar: 'لم أطلب طعاماً وأنا غير جائع قط', en: 'I have never ordered food while not hungry' },
    { ar: 'لم أبكِ أمام فيلم قط', en: 'I have never cried at a movie' },
    { ar: 'لم أخبّئ هديةً حتى يوم المناسبة قط', en: 'I have never hidden a gift until the big day' },
    { ar: 'لم أضيّع هاتفي قط', en: 'I have never lost my phone' },
    { ar: 'لم أتحدث مع نفسي بصوت عالٍ قط', en: 'I have never talked to myself out loud' },
    { ar: 'لم أغيّر رأيي في شخص بعد أول انطباع قط', en: 'I have never changed my mind after a first impression' },
    { ar: 'لم أقرأ كتاباً كاملاً في جلسة واحدة قط', en: 'I have never read a whole book in one sitting' },
    { ar: 'لم أتعلّم مهارة جديدة لمجرد الفضول قط', en: 'I have never learned a skill out of pure curiosity' },
    { ar: 'لم أرقص وحدي في البيت قط', en: 'I have never danced alone at home' },
    { ar: 'لم أخطط لرحلة ثم ألغيتها قط', en: 'I have never planned a trip and cancelled it' },
    { ar: 'لم أنم في السينما قط', en: 'I have never fallen asleep at the cinema' },
    { ar: 'لم أحتفظ برسالة قديمة لأني أحبها قط', en: 'I have never kept an old message because I love it' },
    { ar: 'لم أجرّب طبخة جديدة وفشلت فيها قط', en: 'I have never tried a new recipe and failed' },
    { ar: 'لم أضِع في طريق أعرفه قط', en: 'I have never gotten lost on a route I know' },
    { ar: 'لم أقل «سأبدأ غداً» ولم أبدأ قط', en: 'I have never said "I will start tomorrow" and did not' },
    { ar: 'لم أشاهد شروق الشمس عمداً قط', en: 'I have never watched a sunrise on purpose' },
    { ar: 'لم أضحك حتى دمعت عيناي قط', en: 'I have never laughed until I cried' }
];

module.exports = { TRUTHS, DARES, WOULD_YOU_RATHER, NEVER_HAVE_I_EVER };
