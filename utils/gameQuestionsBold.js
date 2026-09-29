// MatchHala - أسئلة «المستوى الجريء» (level: 'bold')
// رومانسية/شخصية بأسلوب لطيف — لا جنس ولا طلب صور أو بيانات اتصال.
// تُستخدم فقط عند موافقة الطرفين (18+). أضف في النهاية فقط: الزرع يعتمد على العدد.

const TRUTHS = [
    { ar: 'ما أكثر شيء جذبك في آخر شخص أعجبك؟', en: 'What attracted you most about the last person you liked?' },
    { ar: 'هل سبق أن أعجبك شخص من أول نظرة؟ احكِ القصة.', en: 'Have you ever liked someone at first sight? Tell the story.' },
    { ar: 'ما الصفة التي لا تحتملها في علاقة؟', en: 'What trait can you not stand in a relationship?' },
    { ar: 'ما أول شيء تلاحظه في ابتسامة الشخص؟', en: 'What do you first notice about someone\'s smile?' },
    { ar: 'ما موعدك الرومانسي المثالي؟', en: 'What is your ideal romantic date?' },
    { ar: 'ما أجمل كلمة تتمنى أن يقولها لك شريك حياتك؟', en: 'What is the loveliest thing you wish your partner would say?' },
    { ar: 'هل تؤمن بالحب من أول نظرة؟ ولماذا؟', en: 'Do you believe in love at first sight? Why?' },
    { ar: 'ما أكثر موقف محرج مرّ عليك في موعد أول؟', en: 'What was your most awkward first-date moment?' },
    { ar: 'ما الذي يجعلك تُعجَب بشخص بعد الحديث معه؟', en: 'What makes you like someone after talking to them?' },
    { ar: 'هل تفضّل أن تكون المبادر أم أن تنتظر؟ ولماذا؟', en: 'Do you prefer making the first move or waiting? Why?' },
    { ar: 'ما أكثر شيء تخاف منه في العلاقات؟', en: 'What do you fear most in relationships?' },
    { ar: 'ما أول شيء تحب أن يعرفه الطرف الآخر عنك؟', en: 'What is the first thing you want the other person to know about you?' }
];

const DARES = [
    { ar: 'سجّل رسالة صوتية تقول فيها مجاملة صادقة للشخص الذي تكلّمه.', en: 'Send a voice message with a sincere compliment to the person you are talking to.' },
    { ar: 'اكتب ثلاث صفات تراها جميلة فيه حتى الآن.', en: 'Write three qualities you find lovely in them so far.' },
    { ar: 'اقترح خطة موعد مثالي في ثلاث جمل.', en: 'Suggest an ideal date plan in three sentences.' },
    { ar: 'أرسل أغنية رومانسية تحبها وقل لماذا.', en: 'Send a romantic song you like and say why.' },
    { ar: 'اكتب بيتاً شعرياً قصيراً يعبّر عن لقائنا.', en: 'Write a short verse about our meeting.' },
    { ar: 'سجّل رسالة صوتية بأسلوب شاعر يصف أول محادثة بيننا.', en: 'Describe our first conversation like a poet in a voice message.' },
    { ar: 'اكتب رسالة قصيرة كأنها أول رسالة حب في فيلم قديم.', en: 'Write a short message like the first love letter in an old movie.' },
    { ar: 'أخبرنا عن أكثر شيء يجعلك تبتسم عندما تتحدث معي.', en: 'Tell us what makes you smile when you talk to me.' },
    { ar: 'قل لي بصراحة ما أول انطباع أخذته عني.', en: 'Tell me honestly your first impression of me.' },
    { ar: 'اقترح اسماً لقصتنا لو كانت فيلماً.', en: 'Suggest a title for our story as a movie.' }
];

const WOULD_YOU_RATHER = [
    { a: { ar: 'عشاء تحت النجوم', en: 'Dinner under the stars' }, b: { ar: 'عشاء في مطعم فاخر', en: 'Dinner at a fancy restaurant' } },
    { a: { ar: 'شريك يحب المغامرة', en: 'A partner who loves adventure' }, b: { ar: 'شريك يحب الهدوء', en: 'A partner who loves calm' } },
    { a: { ar: 'رسالة حب بخط اليد', en: 'A handwritten love letter' }, b: { ar: 'مفاجأة رومانسية', en: 'A romantic surprise' } },
    { a: { ar: 'أن تعبّر بالكلام', en: 'Express feelings with words' }, b: { ar: 'أن تعبّر بالأفعال', en: 'Express feelings with actions' } },
    { a: { ar: 'حب هادئ ودائم', en: 'A calm lasting love' }, b: { ar: 'حب مشتعل ومغامر', en: 'A fiery adventurous love' } },
    { a: { ar: 'أن يعرف شريكك ما تفكر فيه', en: 'Your partner always knows what you think' }, b: { ar: 'أن يفاجئك دائماً', en: 'Your partner always surprises you' } },
    { a: { ar: 'رحلة رومانسية لمدينة عريقة', en: 'A romantic trip to an old city' }, b: { ar: 'رحلة على شاطئ هادئ', en: 'A trip to a quiet beach' } },
    { a: { ar: 'أن تتعارفا ببطء', en: 'Getting to know each other slowly' }, b: { ar: 'أن تتقرّبا بسرعة', en: 'Getting close quickly' } },
    { a: { ar: 'غيرة خفيفة تدلّ على الاهتمام', en: 'Light jealousy showing care' }, b: { ar: 'ثقة تامة بلا غيرة', en: 'Complete trust with no jealousy' } },
    { a: { ar: 'أن تكون الأول في حياة أحدهم', en: 'Be the first in someone\'s life' }, b: { ar: 'أن تكون الأهم في حياته', en: 'Be the most important in their life' } }
];

const NEVER_HAVE_I_EVER = [
    { ar: 'لم أُعجَب بشخص من أول نظرة قط', en: 'I have never liked someone at first sight' },
    { ar: 'لم أكتب رسالة لشخص أعجبني ثم حذفتها قط', en: 'I have never written to a crush and deleted it' },
    { ar: 'لم أتردد في إرسال رسالة لمن أعجبني قط', en: 'I have never hesitated to message a crush' },
    { ar: 'لم أقضِ ساعات أفكر بماذا أرد على رسالة قط', en: 'I have never spent hours deciding how to reply to a message' },
    { ar: 'لم أحضر موعداً أول وأنا متوتر قط', en: 'I have never been nervous at a first date' },
    { ar: 'لم أُعجَب بشخص من صوته قط', en: 'I have never liked someone for their voice' },
    { ar: 'لم أتخيّل موعداً مثالياً قط', en: 'I have never imagined a perfect date' },
    { ar: 'لم أحتفظ بذكرى صغيرة من شخص أعجبني قط', en: 'I have never kept a small keepsake from a crush' },
    { ar: 'لم أتعلّق بشخص من خلال الحديث فقط قط', en: 'I have never grown attached to someone just by talking' },
    { ar: 'لم أبتسم لشاشة هاتفي بسبب رسالة قط', en: 'I have never smiled at my phone because of a message' }
];

module.exports = { TRUTHS, DARES, WOULD_YOU_RATHER, NEVER_HAVE_I_EVER };
