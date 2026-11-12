# Urban Accident Intelligence (UAI) Research Platform
## System Architecture & Geomatics Mathematical Formulation Reference

---

## 1. System Architecture Overview

**Urban Accident Intelligence (UAI)** is a full-stack geocomputational research and geovisual analytics platform engineered for network-constrained spatiotemporal road accident analysis, uncertainty-aware Volunteered Geographic Information (VGI) conflation, and exposure-normalized Empirical Bayes safety modeling.

### Four-Tier Decoupled Architecture
1. **Hardware-Accelerated Geovisual Presentation Tier (`frontend/`):**
   - **React 18 + TypeScript + MapLibre GL JS (WebGL2)** delivering Coordinated Multiple Views (CMV) with bidirectional linked brushing across vector network layers, temporal brushes, $7 \times 24$ diurnal matrices, Empirical Bayes shrinkage plots, and $3 \times 3$ bivariate risk–uncertainty cartography.
   - Zero-external-dependency self-contained vector cartographic context (Main River hydrography, urban blocks, metric graticules, grade-separated road casings) in both Dark Intelligence and Light Publication themes.
2. **RESTful & OGC GeoJSON Contract Tier (`backend/app/api/`):**
   - **FastAPI + Pydantic v2** enforcing strict schema validation, role-based access control (`simulation_scientist`, `citizen_reporter`, `data_steward`, `gis_researcher`, `safety_engineer`, `mobility_analyst`), asynchronous/background geoprocessing job tracking (`spatial_analysis_jobs`), and open geospatial exports (`GeoJSON`, `CSV`).
3. **Computational Spatial Statistics & Graph Engine (`backend/app/services/`):**
   - **NumPy + SciPy (`csgraph.dijkstra`, sparse linear algebra) + NetworkX + Shapely 2.0 (GEOS) + PyProj (PROJ 9.6)**.
   - Operates strictly in metric projected space (`EPSG:25832` — ETRS89 / UTM Zone 32N, meters) over a Linear Referencing System (LRS) and Lixel Dual Graph $G_{\mathcal{L}} = (\mathcal{L}, A_{\mathcal{L}})$, transforming to `EPSG:4326` (WGS84) exclusively at the GeoJSON serialization boundary.
4. **Relational-Spatial Persistence Tier (`migrations/`, `backend/app/db.py`):**
   - Normalized 15-table relational-spatial schema with explicit SRID enforcement (`25832` canonical metric, `4326` serialization), R\*Tree / GiST spatial indexes on nodes, segments, lixels, raw VGI coordinates, and snapped network coordinates, plus UTC temporal B-Tree/BRIN indexes.
   - Dual-runtime persistence: PostGIS 16-3.4 (`migrations/001_postgis_schema.sql` via `docker-compose.yml`) and embedded SpatiaLite 5.1 + SQLite R\*Tree (`migrations/002_spatialite_schema.sql`) for persistent self-contained sandbox execution.

---

## 2. Formal Mathematical Formulations

### 2.1 Linear Referencing System (LRS) & Lixel Dual Graph (MAUP Mitigation)
Let $G = (V, E)$ be an urban road network embedded in metric space $\mathbb{R}^2$ (`EPSG:25832`) with elevation levels $z(e) \in \{0, 1\}$ capturing grade-separated overpasses. Each edge $e \in E$ has metric arc-length $L_e > 0$ parameterized by $m \in [0, L_e]$.
Given target lixel resolution $\Delta \ell \in \{10, 25, 50\}\text{ m}$, edge $e$ is partitioned into $K_e = \max(1, \text{round}(L_e / \Delta \ell))$ uniform linear units:
$$\ell_{e,k} = [m_{k-1}, m_k], \quad m_k = \frac{k}{K_e} L_e, \quad |\ell_{e,k}| = \frac{L_e}{K_e}$$
The **Lixel Dual Graph** $G_{\mathcal{L}} = (\mathcal{L}, A_{\mathcal{L}})$ connects adjacent lixels $(q_a, q_b)$ with metric step weight $\frac{|\ell_a| + |\ell_b|}{2}$ if and only if they are consecutive along a shared parent edge $e$ or incident to a shared topological junction node $v \in V$ (preventing topological short-circuits across grade-separated overpasses where $z(e_1) \neq z(e_2)$ without a shared node). All-pairs lixel shortest-path distances $D_{\text{net}} = [d_{\text{net}}(q_i, q_j)]$ are solved via sparse Dijkstra traversal over $G_{\mathcal{L}}$.

### 2.2 Seeded Inhomogeneous Spatiotemporal Point Process on $G$
Ground-truth crash events follow a controlled Cox/Poisson point process on $G \times [0, T]$ with true intensity $\lambda(e, m, t)$ ($\text{crashes} \cdot \text{km}^{-1} \cdot \text{yr}^{-1}$):
$$\lambda(e, m, t) = \lambda_0 \cdot \left(\frac{\text{AADT}_e}{10^4}\right)^{\beta} \cdot \left(1 + \alpha_{\text{junc}} \exp\!\left(-\frac{d_{\text{junc}}(e, m)}{\tau_{\text{junc}}}\right)\right) \cdot \psi_{\text{geom}}(e) \cdot \omega_{\text{diurnal}}(t) \cdot \eta_{\text{env}}(e, t)$$
Expected count on lixel $q = (e, [m_0, m_1])$ over period $T_{\text{yr}}$ is $\Lambda_q = |\ell_q|_{\text{km}} \int_0^{T_{\text{yr}}} \lambda(e, m_{\text{mid}}, t)\,dt$, from which exact realizations $N_q \sim \text{Poisson}(\Lambda_q)$ and VGI noisy/multi-witness observations $\tilde{\mathbf{x}}_{i,w} = \mathbf{x}(e_i, m_i) + \mathcal{N}(\mathbf{0}, \sigma_{\text{pos}}^2 \mathbf{I}_2)$ are drawn reproducibly.

### 2.3 Probabilistic Topological Map-Matching & Spatiotemporal VGI Conflation
For raw citizen report $\tilde{\mathbf{x}} \in \mathbb{R}^2$ (`EPSG:25832`) with observational uncertainty $\sigma_r = \max(\sigma_0, r_{\text{obs}}/2)$ and reported accident category $c$, candidate edges $e \in \mathcal{C}(\tilde{\mathbf{x}})$ within R\*Tree search radius $R_{\max}$ receive posterior snap probability:
$$P(e \mid \tilde{\mathbf{x}}, c) = \frac{\exp\!\left(-\frac{d_{\perp}(e, \tilde{\mathbf{x}})^2}{2\sigma_r^2}\right) \cdot \pi_{\text{class}}(e \mid c) \cdot \tau_{\text{topo}}(e, m_e^*)}{\sum_{e' \in \mathcal{C}(\tilde{\mathbf{x}})} \exp\!\left(-\frac{d_{\perp}(e', \tilde{\mathbf{x}})^2}{2\sigma_r^2}\right) \cdot \pi_{\text{class}}(e' \mid c) \cdot \tau_{\text{topo}}(e', m_{e'}^*)}$$
where $d_{\perp}(e, \tilde{\mathbf{x}})$ is orthogonal Euclidean distance to $e$ at linear offset $m_e^* \in [0, L_e]$, $\pi_{\text{class}}(e \mid c)$ encodes road-hierarchy/taxonomy compatibility (e.g., suppressing pedestrian/cyclist snapping onto elevated motorway overpasses), and $\tau_{\text{topo}}$ accounts for intersection degree near segment endpoints.

Pairwise VGI spatiotemporal network affinity between reports $i$ and $j$:
$$K_{\text{ST}}(i, j) = \exp\!\left(-\frac{d_{\text{net}}(s_i, s_j)}{h_S}\right) \cdot \exp\!\left(-\frac{|t_i - t_j|}{h_T}\right) \cdot \kappa_{\text{attr}}(i, j)$$
For a cluster $\mathcal{G}$ of corroborating witness reports, composite **VGI Credibility Score** $C(\mathcal{G}) \in [0, 1]$ is computed via independent witness corroboration:
$$C(\mathcal{G}) = \text{clip}_{[0,1]}\!\left[\left(1 - \prod_{r \in \mathcal{G}} \left(1 - w_0 \cdot P_{\text{snap}}(r) \cdot \rho_{\text{user}}(r) \cdot e^{-\Delta t_{\text{lag}}(r)/\tau_{\text{lag}}}\right)\right) \cdot \text{Consistency}(\mathcal{G})\right]$$

### 2.4 Network Kernel Density Estimation (NKDE) vs. Planar KDE
For events $\{(s_i, w_i)\}_{i=1}^n$ on $G$ and network bandwidth $h_{\text{net}} > 0$, mass-conserving / equal-split corrected Lixel NKDE at lixel $q \in \mathcal{L}$ is:
$$\hat{\lambda}_{\text{NKDE}}(q) = \sum_{i=1}^{n} w_i \cdot \frac{K\!\left(\frac{d_{\text{net}}(q, s_i)}{h_{\text{net}}}\right)}{Z_{\text{net}}(s_i; h_{\text{net}})}, \quad Z_{\text{net}}(s_i; h_{\text{net}}) = \sum_{q' \in \mathcal{L}} K\!\left(\frac{d_{\text{net}}(q', s_i)}{h_{\text{net}}}\right) |\ell_{q'}|$$
where $Z_{\text{net}}(s_i; h_{\text{net}})$ normalizes 1D kernel mass over the branching topology around $s_i$, eliminating high-degree node inflation and guaranteeing $\sum_{q \in \mathcal{L}} \hat{\lambda}_{\text{NKDE}}(q)|\ell_q| = \sum_{i=1}^n w_i$. Supported kernels: Quartic $\frac{15}{16}(1-u^2)^2\mathbb{I}(u\le 1)$, Epanechnikov $\frac{3}{4}(1-u^2)\mathbb{I}(u\le 1)$, and truncated Gaussian $\frac{1}{\sqrt{2\pi}}e^{-u^2/2}\mathbb{I}(u\le 3)$.
Planar distortion bias at lixel $q$ compares normalized Euclidean KDE ($d_{\text{Euc}}$) against NKDE ($d_{\text{net}}$):
$$\Delta_{\text{Planar-NKDE}}(q) = \hat{\lambda}_{\text{Planar}}^{\text{unit}}(q) - \hat{\lambda}_{\text{NKDE}}^{\text{unit}}(q)$$

### 2.5 Network Getis-Ord $G_i^*(d_{\text{net}})$ & Moran's $I$ with FDR Correction
Given network spatial weights $W_{\text{net}} = [w_{ij}]$ defined over shortest-path distances $d_{\text{net}}(q_i, q_j)$:
$$G_i^* = \frac{\sum_{j=1}^M w_{ij} x_j - \bar{X} \sum_{j=1}^M w_{ij}}{S \sqrt{\frac{M \sum_{j=1}^M w_{ij}^2 - (\sum_{j=1}^M w_{ij})^2}{M - 1}}}$$
Statistical significance is evaluated via $R$ Monte Carlo spatial permutations yielding pseudo-$p$-values $p_i = \frac{\#\{r : |G_i^{*(r)}| \ge |G_i^{*\text{obs}}|\} + 1}{R + 1}$, adjusted for multiple testing across $M$ lixels via Benjamini–Hochberg False Discovery Rate ($q_i$).

### 2.6 Negative Binomial SPF & Empirical Bayes (EB) RTM Smoothing
For segment $e$ in road hierarchy stratum $c$, the Negative Binomial Safety Performance Function (SPF) predicts baseline crashes:
$$\mu_e = L_{e,\text{km}} \cdot T_{\text{yr}} \cdot \exp(\beta_{0,c}) \cdot (\text{AADT}_e)^{\beta_{1,c}} \cdot \exp(\beta_{2,c}\text{Junc}_e)$$
with stratum overdispersion parameter $\alpha_c > 0$ ($\text{Var}(N_e) = \mu_e + \alpha_c \mu_e^2$). The **Empirical Bayes Expected Crash Estimate** shrinks Regression-to-the-Mean (RTM) spikes via weight $w_e$:
$$w_e = \frac{1}{1 + \alpha_c \mu_e}, \quad \hat{N}_{e,\text{EB}} = w_e \mu_e + (1 - w_e) N_e, \quad \text{SE}(\hat{N}_{e,\text{EB}}) = \sqrt{(1 - w_e)\hat{N}_{e,\text{EB}}}$$
**Potential for Safety Improvement (PSI / Excess Crash Frequency):**
$$\text{PSI}_e = \hat{N}_{e,\text{EB}} - \mu_e$$
