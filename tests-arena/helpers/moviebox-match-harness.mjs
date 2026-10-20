/**
 * Harness for `scripts/lib/moviebox-match.mjs` — jest cannot import .mjs
 * directly, so the pure matcher is loaded through a child process with
 * fixture input. Keeps the harvester's matching logic honestly tested
 * without ever touching the network.
 *
 * Input  (env): MBM_SCENARIO = { op, … }
 * Output (stdout): …__RESULT__{…}
 */
const scenario = JSON.parse(process.env.MBM_SCENARIO || '{}');
const mod = await import(process.env.MBM_MODULE_PATH);
const harvester = process.env.MBM_HARVESTER_PATH ? await import(process.env.MBM_HARVESTER_PATH) : null;

let result;
switch (scenario.op) {
    case 'normalize':
        result = scenario.values.map((value) => ({
            normalized: mod.normalizeTitle(value),
            tokens: mod.titleTokens(value),
            dubHint: mod.splitDubHint(value).dubHint,
        }));
        break;
    case 'titleScore':
        result = mod.titleScore(scenario.a, scenario.b);
        break;
    case 'yearScore':
        result = mod.yearScore(scenario.a, scenario.b);
        break;
    case 'rank':
        result = mod.rankCandidates(scenario.target, scenario.items);
        break;
    case 'score':
        result = mod.scoreCandidate(scenario.target, scenario.item);
        break;
    case 'playRef':
        result = mod.pickPlayRef(scenario.detail, scenario.fallback);
        break;
    case 'language':
        result = mod.languageOfRef(scenario.ref);
        break;
    case 'pins':
        result = harvester.applyPins(scenario.pins, scenario.previous);
        break;
    case 'parseUrl':
        result = harvester.parseMovieboxUrl(scenario.url);
        break;
    case 'pickDub':
        result = mod.pickDub(scenario.dubs, scenario.prefer);
        break;
    case 'constants':
        result = { accept: mod.MATCH_ACCEPT, review: mod.MATCH_REVIEW };
        break;
    default:
        result = { error: `unknown op ${scenario.op}` };
}

process.stdout.write(`__RESULT__${JSON.stringify(result)}`);
