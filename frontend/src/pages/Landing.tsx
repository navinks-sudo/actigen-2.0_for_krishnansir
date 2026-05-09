import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Sparkles, ScanText, Tags, Network, FileText, Languages,
  ArrowRight, ShieldCheck, Workflow, CheckCircle2,
} from "lucide-react";
import BrandLogo from "../components/BrandLogo";

const STAGE_CARDS = [
  {
    icon: Sparkles,
    name: "Image Enhancement",
    desc: "Iterative deskew, denoise, contrast & sharpen until QS ≥ 95.",
    accent: "from-teal-200 to-emerald-200",
    iconColor: "text-teal-600",
    qc: "Before/after slider · Dual quality gauges",
  },
  {
    icon: ScanText,
    name: "Text IQ — OCR",
    desc: "EasyOCR extracts text. Edit in workbench, CER computed live.",
    accent: "from-sky-200 to-cyan-200",
    iconColor: "text-sky-600",
    qc: "Editable text · CER vs corrected ground truth",
  },
  {
    icon: Tags,
    name: "Doc Class",
    desc: "TF-IDF cosine over 10 class prototypes with override picker.",
    accent: "from-pink-200 to-rose-200",
    iconColor: "text-pink-600",
    qc: "Confidence bars · Class override",
  },
  {
    icon: Network,
    name: "Index Genius",
    desc: "Extracts emails, phones, URLs, money, dates, IDs & keywords.",
    accent: "from-lime-200 to-emerald-200",
    iconColor: "text-emerald-600",
    qc: "Per-field add / edit / delete",
  },
  {
    icon: FileText,
    name: "Abstractor",
    desc: "LSA extractive summary. Edit, CER computed against model.",
    accent: "from-amber-200 to-orange-200",
    iconColor: "text-amber-600",
    qc: "Editable summary · CER · Compression ratio",
  },
  {
    icon: Languages,
    name: "Lingua AI",
    desc: "Translates corrected output to many languages, including major Indic languages.",
    accent: "from-cyan-200 to-teal-200",
    iconColor: "text-cyan-600",
    qc: "Source / target side-by-side · Copy",
  },
];

export default function Landing() {
  return (
    <div className="space-y-24 pb-16">
      {/* Hero */}
      <section className="relative pt-12 md:pt-20">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-center mb-10"
          >
            <BrandLogo variant="mark" className="justify-center" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-ink-200/80 shadow-soft text-xs text-ink-700 font-medium mb-6"
          >
            <Sparkles className="w-3.5 h-3.5 text-brand-500" />
            6-stage document intelligence pipeline · with QC at every step
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-display text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05]"
          >
            Turn any document into{" "}
            <span className="gradient-text">structured intelligence</span>.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-6 text-lg md:text-xl text-ink-600 max-w-2xl mx-auto"
          >
            ACTIGEN 2.0 enhances images, OCRs text, classifies, indexes, summarizes,
            and translates — with a human-in-the-loop QC workbench at every stage.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-10 flex items-center justify-center gap-3 flex-wrap"
          >
            <Link to="/login" className="btn-primary text-base px-6 py-3">
              Sign in to continue <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#stages" className="btn-ghost text-base px-6 py-3">
              See the 6 stages
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-6 text-xs text-ink-500"
          >
            Demo credentials · <span className="font-mono text-ink-700">admin / admin</span>
          </motion.div>
        </div>

        {/* Floating preview card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="mt-16 max-w-5xl mx-auto"
        >
          <div className="surface p-6 md:p-8">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-3 h-3 rounded-full bg-rose-400" />
              <div className="w-3 h-3 rounded-full bg-amber-400" />
              <div className="w-3 h-3 rounded-full bg-emerald-400" />
              <div className="ml-3 text-xs text-ink-500 font-mono">actigen.app/doc/124</div>
            </div>
            <div className="grid grid-cols-6 gap-3">
              {STAGE_CARDS.map((s, i) => (
                <motion.div
                  key={s.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  className="col-span-1 flex flex-col items-center gap-2"
                >
                  <div
                    className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${s.accent} flex items-center justify-center shadow-soft`}
                  >
                    <s.icon className={`w-6 h-6 ${s.iconColor}`} />
                  </div>
                  <div className="text-[10px] text-ink-600 text-center font-medium leading-tight">
                    {s.name.split(" ")[0]}
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="mt-5 h-1 rounded-full bg-ink-100 overflow-hidden">
              <motion.div
                className="h-full bg-brand-grad"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 1.6, delay: 0.5 }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
              <span>Pipeline progress</span>
              <span className="text-emerald-600 font-medium inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> All 6 stages QC-approved
              </span>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Stages section */}
      <section id="stages" className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <div className="label inline-flex items-center gap-2">
            <Workflow className="w-3.5 h-3.5" /> The Pipeline
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-bold mt-4 tracking-tight">
            Six stages, one canvas.
          </h2>
          <p className="text-ink-600 mt-4 max-w-2xl mx-auto text-lg">
            Every stage runs automatically and pauses for QC. Approve to advance,
            reject to re-run. Nothing leaves your machine without your sign-off.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {STAGE_CARDS.map((s, i) => (
            <motion.div
              key={s.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.05 }}
              className="surface p-6 hover:shadow-pop hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-start gap-4">
                <div
                  className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${s.accent} flex items-center justify-center shrink-0 shadow-soft`}
                >
                  <s.icon className={`w-6 h-6 ${s.iconColor}`} />
                </div>
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-ink-400 font-bold">
                    Stage {i + 1}
                  </div>
                  <h3 className="text-lg font-bold mt-0.5">{s.name}</h3>
                </div>
              </div>
              <p className="mt-4 text-sm text-ink-600 leading-relaxed">{s.desc}</p>
              <div className="mt-4 pt-4 border-t border-ink-100">
                <div className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold mb-1">
                  QC Workbench
                </div>
                <div className="text-xs text-ink-700">{s.qc}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Trust strip */}
      <section className="max-w-5xl mx-auto">
        <div className="surface p-8 md:p-10 bg-gradient-to-br from-white via-white to-brand-50/40">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Human-in-the-loop</div>
                <p className="text-sm text-ink-600 mt-1">
                  Every stage requires QC approval. Nothing auto-completes silently.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Workflow className="w-6 h-6 text-brand-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Composable pipeline</div>
                <p className="text-sm text-ink-600 mt-1">
                  Re-run any stage. Override classifications. Edit metadata.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Sparkles className="w-6 h-6 text-pink-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Local & private</div>
                <p className="text-sm text-ink-600 mt-1">
                  All ML runs locally. No data leaves your machine (except translation).
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="text-center">
        <h3 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
          Ready to see your documents transformed?
        </h3>
        <Link to="/login" className="btn-primary text-base px-6 py-3 mt-6">
          Sign in <ArrowRight className="w-4 h-4" />
        </Link>
      </section>
    </div>
  );
}
