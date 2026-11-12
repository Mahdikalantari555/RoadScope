"use client";

import React from "react";
import { BookOpen, Download, CheckCircle2, X, Cpu } from "lucide-react";

interface MathematicalFormulationModalProps {
  isOpen: boolean;
  onClose: () => void;
  latestJob: {
    jobCode: string;
    jobType: string;
    sridUsed: number;
    sampleSize: number;
    executionTimeMs: number;
    parametersJson: unknown;
    summaryMetricsJson: unknown;
    createdAt: string;
  } | null;
  onDownloadGeoJson: (layer: "lixels" | "segments" | "incidents") => void;
  onDownloadCsvSummary: () => void;
}

export default function MathematicalFormulationModal({
  isOpen,
  onClose,
  latestJob,
  onDownloadGeoJson,
  onDownloadCsvSummary,
}: MathematicalFormulationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-teal-400" />
            <div>
              <h2 className="text-sm font-bold tracking-wide text-white uppercase">
                GIScience Mathematical Formulations &amp; Reproducible Provenance (US-4.5)
              </h2>
              <p className="text-[11px] text-slate-400">
                Network-Constrained Spatial Statistics, Topological Map-Matching &amp; Empirical Bayes RTM Correction
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs leading-relaxed">
          {/* Execution Metadata Banner */}
          {latestJob && (
            <div className="rounded-lg border border-teal-500/30 bg-teal-950/20 p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold text-teal-300">
                  <Cpu className="h-4 w-4" /> Latest Geocomputation Job Provenance
                </span>
                <span className="rounded bg-teal-500/20 px-2 py-0.5 font-mono text-[11px] text-teal-300">
                  {latestJob.jobCode}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 block">Projected Metric CRS:</span>
                  <strong className="text-white">EPSG:{latestJob.sridUsed} (UTM 18N)</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Active Sample Size:</span>
                  <strong className="text-white">N = {latestJob.sampleSize} Crashes</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Vector Compute Runtime:</span>
                  <strong className="text-emerald-400">{latestJob.executionTimeMs} ms</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Serialization Boundary:</span>
                  <strong className="text-sky-300">EPSG:4326 (WGS84)</strong>
                </div>
              </div>
            </div>
          )}

          {/* 5 Core Mathematical Formulations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-2">
              <h3 className="font-bold text-teal-400">
                1. Equal-Split Network KDE (Okabe &amp; Sugihara, 2012)
              </h3>
              <p className="text-slate-300">
                To eliminate planar Euclidean bleeding across parallel corridors and grade-separated overpasses, road edges e &isin; E are segmented into uniform linear units (<strong>lixels</strong> l<sub>i</sub>) of length &Delta;l. Density is evaluated strictly along shortest-path network distance d<sub>net</sub>(l<sub>i</sub>, s<sub>j</sub>):
              </p>
              <div className="rounded bg-slate-900 p-2.5 font-mono text-[11px] text-amber-300 overflow-x-auto">
                &lambda;&#770;_NKDE(l_i) = (1 / h_net) &middot; &Sigma;_j [ w_j / &Pi;_(v &isin; path) (deg(v) - 1)^&eta; ] &middot; K( d_net(l_i, s_j) / h_net )
              </div>
              <p className="text-[11px] text-slate-400">
                Where &Pi;(deg(v) - 1)<sup>&eta;</sup> enforces unbiased probability mass conservation across multi-leg intersection nodes.
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-2">
              <h3 className="font-bold text-teal-400">
                2. Network Getis-Ord G<sub>i</sub>*(d) &amp; Benjamini-Hochberg FDR
              </h3>
              <p className="text-slate-300">
                Using a topological network spatial weights matrix W<sub>net</sub> where w<sub>ij</sub>(d<sub>net</sub>) &gt; 0 &hArr; d<sub>net</sub>(l<sub>i</sub>, l<sub>j</sub>) &le; d<sub>c</sub>:
              </p>
              <div className="rounded bg-slate-900 p-2.5 font-mono text-[11px] text-amber-300 overflow-x-auto">
                G_i*(d) = [ &Sigma;_j w_ij x_j - x&#772; &Sigma;_j w_ij ] / [ S &middot; &radic;((N &Sigma;_j w_ij&sup2; - (&Sigma;_j w_ij)&sup2;) / (N - 1)) ]
              </div>
              <p className="text-[11px] text-slate-400">
                Pseudo-p-values are computed via M = 199 conditional permutations and adjusted via Benjamini-Hochberg False Discovery Rate (p<sub>FDR</sub> = min(1, p<sub>(k)</sub> &middot; N / k)) to prevent multiple-testing Type I error inflation.
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-2">
              <h3 className="font-bold text-teal-400">
                3. Probabilistic Topological Map-Matching &amp; VGI Conflation
              </h3>
              <p className="text-slate-300">
                Given noisy citizen observation p<sub>raw</sub> = (x, y) with uncertainty radius r<sub>obs</sub>, candidate edge snaps (e<sub>k</sub>, m<sub>k</sub>) are scored by combining orthogonal Gaussian distance, road hierarchy prior, and junction topology:
              </p>
              <div className="rounded bg-slate-900 p-2.5 font-mono text-[11px] text-amber-300 overflow-x-auto">
                P(e_k | p_raw) &prop; exp(-d_&perp;&sup2; / 2&sigma;&sup2;) &middot; W_class(e_k) &middot; (1 + &gamma; exp(-d_node(m_k) / d_0))
              </div>
              <p className="text-[11px] text-slate-400">
                Duplicate witness bursts are conflated via spatiotemporal network decay kernel K<sub>st</sub>(i, j) = exp(-&Delta;d<sub>net</sub> / h<sub>d</sub>) &middot; exp(-&Delta;t / h<sub>t</sub>).
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 space-y-2">
              <h3 className="font-bold text-teal-400">
                4. Empirical Bayes (EB) Smoothing &amp; RTM Correction (Hauer, 1997)
              </h3>
              <p className="text-slate-300">
                Raw crash counts suffer from Regression-to-the-Mean (RTM). We blend observed crashes N<sub>obs,e</sub> with a Negative Binomial Safety Performance Function (SPF) prior &mu;<sub>SPF</sub>(e) = L<sub>km</sub> &middot; exp(&alpha;<sub>c</sub>) &middot; (AADT<sub>e</sub>)<sup>&beta;<sub>c</sub></sup>:
              </p>
              <div className="rounded bg-slate-900 p-2.5 font-mono text-[11px] text-amber-300 overflow-x-auto">
                E&#770;_EB[N_e] = w_e &middot; &mu;_SPF(e) + (1 - w_e) &middot; N_obs,e ,  where w_e = 1 / (1 + &phi;_c &middot; &mu;_SPF(e))
              </div>
              <p className="text-[11px] text-slate-400">
                Potential for Safety Improvement is PSI<sub>e</sub> = E&#770;<sub>EB</sub>[N<sub>e</sub>] - &mu;<sub>SPF</sub>(e).
              </p>
            </div>
          </div>

          {/* Ground-Truth Benchmarking Equations */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5">
            <h3 className="font-bold text-teal-400 mb-1">
              5. Stochastic Point-Process Ground-Truth Benchmarking (PAI, RRI, RMSE)
            </h3>
            <p className="text-slate-300">
              Because synthetic realizations are generated from a known inhomogeneous network intensity &lambda;(e, m, t), any hotspot model is quantitatively benchmarked via the <strong>Prediction Accuracy Index</strong> PAI<sub>k%</sub> = (n<sub>k</sub> / N<sub>total</sub>) / (L<sub>k</sub> / L<sub>total</sub>), the <strong>Recapture Rate Index (RRI)</strong> of true intensity mass &int;<sub>L_k</sub> &lambda;(s)ds / &int;<sub>G</sub> &lambda;(s)ds, and lixel-level normalized <strong>RMSE</strong>.
            </p>
          </div>
        </div>

        {/* Footer with Open Geospatial Export Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950 px-5 py-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>Open Geospatial Consortium (OGC) GeoJSON &amp; Tabular Export Ready</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onDownloadGeoJson("lixels")}
              className="flex items-center gap-1.5 rounded bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500"
            >
              <Download className="h-3.5 w-3.5" /> Export Lixels GeoJSON
            </button>
            <button
              onClick={() => onDownloadGeoJson("segments")}
              className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
            >
              <Download className="h-3.5 w-3.5" /> Export EB Segments GeoJSON
            </button>
            <button
              onClick={() => onDownloadGeoJson("incidents")}
              className="flex items-center gap-1.5 rounded bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <Download className="h-3.5 w-3.5" /> Export VGI Incidents GeoJSON
            </button>
            <button
              onClick={onDownloadCsvSummary}
              className="flex items-center gap-1.5 rounded bg-amber-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
            >
              <Download className="h-3.5 w-3.5" /> Export Statistical CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
