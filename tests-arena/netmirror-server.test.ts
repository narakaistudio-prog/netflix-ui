// "Other" server = NetMirror (net77.cc) — owner:
//   "netflix ke andar ek other karke server banao option aur wo other server
//    https://net77.cc/home iska rahega... test bas dhurandhar par karo...
//    netmirror wala jo play ke button hai usse crop karke laga dena apne play
//    ke button se replace kar dena."
//
// net77.cc login ke peeche hai aur framing block karta hai, isliye player
// embed nahi hota: button unke apne button ka crop hai aur dabane par unki
// site new tab me khulti hai (wahan user ka login chalta hai).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isNetmirrorTitle, NETMIRROR_HOME_URL, NETMIRROR_PLAY_ASPECT, NETMIRROR_SERVER_LABEL } from '../lib/netmirror';

const ROOT = join(__dirname, '..');
const MODAL_PATH = join(ROOT, 'components', 'MovieList', 'MovieDetailModal.tsx');
const BUTTON_PATH = join(ROOT, 'components', 'NetmirrorPlayButton.tsx');
const ASSET_PATH = join(ROOT, 'assets', 'netmirror', 'netmirror-play.png');

test('Other server ka naam aur URL owner ke hisaab se', () => {
    expect(NETMIRROR_SERVER_LABEL).toBe('Other');
    expect(NETMIRROR_HOME_URL).toBe('https://net77.cc/home');
});

test('test scope — sirf Dhurandhar par Other server', () => {
    expect(isNetmirrorTitle('Dhurandhar')).toBe(true);
    expect(isNetmirrorTitle('DHURANDHAR')).toBe(true);
    expect(isNetmirrorTitle('Dhurandhar (2025)')).toBe(true);
    // Baaki titles par kuch nahi badla.
    expect(isNetmirrorTitle('Relentless Crime Drama')).toBe(false);
    expect(isNetmirrorTitle('Sector 36')).toBe(false);
    expect(isNetmirrorTitle('')).toBe(false);
    expect(isNetmirrorTitle(null)).toBe(false);
});

test('modal me Server patti par Other chip hai aur sirf Dhurandhar par aata hai', () => {
    const modal = readFileSync(MODAL_PATH, 'utf8');
    expect(modal).toContain('testID="server-other"');
    expect(modal).toContain('{NETMIRROR_SERVER_LABEL}');
    expect(modal).toContain("import { NETMIRROR_HOME_URL, NETMIRROR_SERVER_LABEL, isNetmirrorTitle } from '@/lib/netmirror';");
    // Availability title se bandhi hai (test scope).
    expect(modal).toContain('const netmirrorAvailable = isNetmirrorTitle(movie?.title);');
    // Other select hone par server row dikhta hai (MovieBox na ho to bhi).
    expect(modal).toContain('{movieboxAvailable || netmirrorAvailable ? (');
});

test('Other server chunne par NetMirror ka asli Play button apne button ki jagah aata hai', () => {
    const modal = readFileSync(MODAL_PATH, 'utf8');
    expect(modal).toContain('<NetmirrorPlayButton height={44} onPress={openNetmirror} />');
    // Purana Play button Other ke waqt nahi dikhta.
    expect(modal).toMatch(/activeServer === 'other' \? \(\s*<NetmirrorPlayButton/);
    // Press karne par NetMirror (embed nahi hota — new tab).
    expect(modal).toContain('window.open(NETMIRROR_HOME_URL');
    expect(modal).toContain("if (activeServer === 'other') {");

    const button = readFileSync(BUTTON_PATH, 'utf8');
    expect(button).toContain("require('../assets/netmirror/netmirror-play.png')");
    expect(button).toContain('testID="netmirror-play"');
});

test('crop NetMirror ke asli button ka hai — 316×106 PNG (158×53 ka 2x)', () => {
    expect(existsSync(ASSET_PATH)).toBe(true);
    expect(statSync(ASSET_PATH).size).toBeGreaterThan(1000);
    const buf = readFileSync(ASSET_PATH);
    expect(buf.slice(1, 4).toString('ascii')).toBe('PNG');
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(316);
    expect(height).toBe(106);
    // Aspect ratio wahi hai jisse button kabhi stretch na ho.
    expect(Math.abs(width / height - NETMIRROR_PLAY_ASPECT)).toBeLessThan(0.001);
});
