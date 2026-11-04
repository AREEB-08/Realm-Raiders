/** The two calls we use from `qrcode` (it ships no types). */
declare module 'qrcode' {
  interface Opts {
    type?: 'svg' | 'terminal' | 'utf8';
    small?: boolean;
    margin?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: { dark?: string; light?: string };
  }
  const QR: { toString(text: string, opts?: Opts): Promise<string> };
  export default QR;
}
