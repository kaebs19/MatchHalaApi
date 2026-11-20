// 📺 إعلانات التطبيق — المواضع، التكرار، الإعفاءات، معرّفات الوحدات.
// يقرؤها التطبيق مع /app/bootstrap (من النسخة التي تلي 12.2). الحدود تُفرض في الخادم (utils/adsConfig.js).
import React, { useEffect, useState } from 'react';
import { getAdsConfig, updateAdsConfig } from '../services/api';
import { useToast } from './Toast';
import './AdsConfigPanel.css';

const PLACEMENT_LABELS = {
    exploreBanner:       ['بانر الاكتشاف', 'شريط أعلى صفحة الاكتشاف'],
    exploreNative:       ['بطاقة الاكتشاف المدمجة', 'إعلان بين البطاقات'],
    exploreInterstitial: ['ملء الشاشة في الاكتشاف', 'بالتناوب مع البطاقة المدمجة'],
    searchBanner:        ['بانر البحث', 'شريط أعلى المقترحين'],
    searchNative:        ['إعلان داخل نتائج البحث', 'بطاقة بين المستخدمين'],
    searchInterstitial:  ['ملء الشاشة عند فتح البحث', 'بعد ثوانٍ من الدخول'],
    storiesNative:       ['إعلان بين القصص', 'بعد عدد من قصص الآخرين'],
    chatInterstitial:    ['ملء الشاشة عند الخروج من محادثة', 'نقطة خروج'],
    profileInterstitial: ['ملء الشاشة عند إغلاق ملف', 'بعد تصفّح كافٍ'],
    ludoRewarded:        ['إعلان بمكافأة في متجر اللودو', 'عملات وجواهر مقابل المشاهدة']
};

const RULE_LABELS = {
    cardsBetweenAdBreaks:        ['بطاقات بين محطتَي إعلان (الاكتشاف)', 'بطاقة'],
    searchNativeEvery:           ['كل كم بطاقة إعلان في البحث', 'بطاقة'],
    storiesBetweenAds:           ['قصص بين إعلانين', 'قصة'],
    nativeAdReadSeconds:         ['ثوانٍ قبل زرّ «متابعة» على الإعلان المدمج', 'ث'],
    interstitialCooldownMinutes: ['الفاصل بين إعلانَي ملء شاشة', 'دقيقة'],
    maxInterstitialsPerDay:      ['أقصى إعلانات ملء شاشة يومياً (0 = إيقاف)', 'إعلان'],
    launchGraceSeconds:          ['لا ملء شاشة في أول … من فتح التطبيق', 'ث'],
    interstitialDelaySeconds:    ['انتظار قبل ملء الشاشة في نقاط الخروج', 'ث'],
    profileMinBrowseSeconds:     ['تصفّح الملف قبل إعلان إغلاقه', 'ث'],
    storyExitQuietSeconds:       ['لا ملء شاشة بعد إغلاق القصص', 'ث']
};

const UNIT_LABELS = {
    banner: 'Banner', interstitial: 'Interstitial', native: 'Native', rewarded: 'Rewarded'
};

export default function AdsConfigPanel() {
    const { showToast } = useToast();
    const [config, setConfig] = useState(null);
    const [meta, setMeta] = useState(null);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    /// آخر نسخة محفوظة — «تراجع» يعيدها
    const [savedConfig, setSavedConfig] = useState(null);

    // ⚠️ تعديل بلا حفظ كان يضيع بصمت عند الخروج (زرّ الحفظ في آخر الصفحة) — تنبيه المتصفح قبل المغادرة
    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    useEffect(() => {
        (async () => {
            try {
                const res = await getAdsConfig();
                if (res.success) { setConfig(res.data.config); setSavedConfig(res.data.config); setMeta(res.data.meta); }
            } catch (e) {
                showToast('تعذّر جلب إعدادات الإعلانات', 'error');
            }
        })();
    }, []);

    const update = (fn) => { setConfig(prev => fn(JSON.parse(JSON.stringify(prev)))); setDirty(true); };

    const save = async () => {
        try {
            setSaving(true);
            const res = await updateAdsConfig(config);
            if (res.success) {
                setConfig(res.data.config);
                setSavedConfig(res.data.config);
                setDirty(false);
                showToast('تم حفظ إعدادات الإعلانات ✅ — تصل التطبيق خلال دقيقة', 'success');
            } else {
                showToast(res.message || 'فشل الحفظ', 'error');
            }
        } catch (e) {
            showToast(e?.response?.data?.message || 'فشل حفظ إعدادات الإعلانات', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!config || !meta) return <div className="ads-config"><p className="ads-config__muted">⏳ جارٍ التحميل…</p></div>;

    return (
        <div className="ads-config">
            <div className="ads-config__head">
                <div>
                    <h2>📺 إعلانات التطبيق</h2>
                    <p className="ads-config__muted">
                        تصل التطبيق مع كل فتح (خلال دقيقة من الحفظ). المشترك في هلا+ معفى دائماً.
                        النسخ حتى 12.2 لا تقرأ هذه الإعدادات وتبقى على قيمها الحالية.
                    </p>
                </div>
                <label className={`ads-config__master ${config.enabled ? 'on' : 'off'}`}>
                    <input type="checkbox" checked={config.enabled}
                        onChange={e => update(c => { c.enabled = e.target.checked; return c; })} />
                    {config.enabled ? '✅ الإعلانات مفعّلة' : '⛔ كل الإعلانات متوقفة'}
                </label>
            </div>

            <section className={`ads-config__card ${config.enabled ? '' : 'is-disabled'}`}>
                <h3>المواضع</h3>
                <div className="ads-config__grid">
                    {meta.placements.map(p => (
                        <label key={p} className="ads-config__toggle">
                            <input type="checkbox" checked={!!config.placements[p]} disabled={!config.enabled}
                                onChange={e => update(c => { c.placements[p] = e.target.checked; return c; })} />
                            <span>
                                <strong>{PLACEMENT_LABELS[p]?.[0] || p}</strong>
                                <small>{PLACEMENT_LABELS[p]?.[1]}</small>
                            </span>
                        </label>
                    ))}
                </div>
            </section>

            <section className={`ads-config__card ${config.enabled ? '' : 'is-disabled'}`}>
                <h3>التكرار والتوقيت</h3>
                <div className="ads-config__grid">
                    {Object.entries(meta.rules).map(([k, [def, min, max]]) => (
                        <label key={k} className="ads-config__field">
                            <span>{RULE_LABELS[k]?.[0] || k}</span>
                            <div className="ads-config__input">
                                <input type="number" onWheel={e => e.currentTarget.blur()} min={min} max={max} value={config.rules[k]} disabled={!config.enabled}
                                    onChange={e => update(c => { c.rules[k] = e.target.value === '' ? '' : Number(e.target.value); return c; })} />
                                <em>{RULE_LABELS[k]?.[1]}</em>
                            </div>
                            <small>الافتراضي {def} · من {min} إلى {max}</small>
                        </label>
                    ))}
                </div>
            </section>

            <section className={`ads-config__card ${config.enabled ? '' : 'is-disabled'}`}>
                <h3>من لا يرى الإعلانات</h3>
                <div className="ads-config__grid">
                    <label className="ads-config__field">
                        <span>إعفاء الحسابات الجديدة أول</span>
                        <div className="ads-config__input">
                            <input type="number" onWheel={e => e.currentTarget.blur()} min={0} max={90} value={config.audience.exemptNewAccountDays} disabled={!config.enabled}
                                onChange={e => update(c => { c.audience.exemptNewAccountDays = e.target.value === '' ? '' : Number(e.target.value); return c; })} />
                            <em>يوم</em>
                        </div>
                        <small>0 = بلا إعفاء</small>
                    </label>
                    <label className="ads-config__toggle">
                        <input type="checkbox" checked={!!config.audience.exemptAdmins} disabled={!config.enabled}
                            onChange={e => update(c => { c.audience.exemptAdmins = e.target.checked; return c; })} />
                        <span><strong>إعفاء حسابات المشرفين</strong><small>اتركه مطفأً لترى الإعلانات كما يراها المستخدم</small></span>
                    </label>
                </div>
            </section>

            <section className="ads-config__card">
                <h3>معرّفات وحدات iOS (اختياري)</h3>
                <p className="ads-config__muted">الفارغ = المعرّف المكتوب في التطبيق. ⚠️ معرّف خاطئ يوقف ذلك النوع — انسخه من AdMob كما هو.</p>
                <div className="ads-config__grid">
                    {Object.keys(UNIT_LABELS).map(k => (
                        <label key={k} className="ads-config__field">
                            <span>{UNIT_LABELS[k]}</span>
                            <input type="text" dir="ltr" placeholder="ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX"
                                value={config.units[k] || ''}
                                onChange={e => update(c => { c.units[k] = e.target.value.trim(); return c; })} />
                        </label>
                    ))}
                </div>
            </section>

            {/* شريط حفظ ثابت أسفل الشاشة ما دامت هناك تغييرات — كان الزرّ في آخر الصفحة فيُنسى */}
            <div className={`ads-config__savebar ${dirty ? 'is-visible' : ''}`}>
                <span>⚠️ لديك تغييرات غير محفوظة في إعدادات الإعلانات</span>
                <div>
                    <button className="ads-config__undo" onClick={() => { setConfig(savedConfig); setDirty(false); }} disabled={saving}>تراجع</button>
                    <button className="btn-save" onClick={save} disabled={saving}>
                        {saving ? '⏳ جاري الحفظ…' : '💾 حفظ'}
                    </button>
                </div>
            </div>
        </div>
    );
}
