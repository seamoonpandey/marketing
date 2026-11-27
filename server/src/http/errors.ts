export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 404. Inside withBrand it also leaves a `denied` audit event for objectType/objectId. */
export class NotFoundError extends HttpError {
  readonly objectType: string;
  readonly objectId: string;
  constructor(objectType: string, objectId: string, message = `${objectType} not found`) {
    super(404, 'not_found', message);
    this.objectType = objectType;
    this.objectId = objectId;
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, 'validation', message);
  }
}

export class BudgetError extends HttpError {
  constructor(message: string) {
    super(402, 'budget', message);
  }
}

export type ErrorBody = { error: { code: string; message: string } };

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}
