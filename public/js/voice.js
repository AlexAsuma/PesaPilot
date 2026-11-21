export class DictationController {
  constructor({ onStart, onTranscript, onError, onEnd }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(SR);
    this.listening = false;
    if (!this.supported) return;

    this.rec = new SR();
    this.rec.continuous = false;
    this.rec.interimResults = true;

    this.rec.onstart = () => {
      this.listening = true;
      onStart?.();
    };

    this.rec.onresult = (ev) => {
      let text = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      const isFinal = ev.results[ev.results.length - 1].isFinal;
      onTranscript?.(text.trim(), isFinal);
    };

    this.rec.onerror = (ev) => {
      if (ev.error !== "aborted") onError?.(ev.error);
    };

    this.rec.onend = () => {
      this.listening = false;
      onEnd?.();
    };
  }

  toggle(lang = "en-KE") {
    if (!this.supported) return;
    if (this.listening) {
      this.rec.stop();
    } else {
      this.rec.lang = lang;
      this.rec.start();
    }
  }
}