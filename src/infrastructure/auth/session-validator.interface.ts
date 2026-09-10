export interface SessionValidator {
  // De momento se asume que las peticiónes que se reciben ya fueron validadas previamente
  validar(): Promise<true>;
}
