export class ReaderError extends Error {
  constructor(code, message, { status = 500, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ReaderError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function publicError(error) {
  if (error instanceof ReaderError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      ...(error.details ? { details: error.details } : {})
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "The content reader failed unexpectedly.",
    status: 500
  };
}

export function errorSummary(error) {
  const safe = publicError(error);
  return {
    code: safe.code,
    message: safe.message,
    ...(safe.details ? { details: safe.details } : {})
  };
}
