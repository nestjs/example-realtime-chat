import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

/**
 * Sends each refusal to the client as an "exception" event with its status code, its message,
 * and the event and payload it refuses, so the client can tell which message failed.
 */
@Catch(HttpException, WsException)
export class ChatExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: HttpException | WsException, host: ArgumentsHost) {
    const ws = host.switchToWs();
    const cause = { pattern: ws.getPattern(), data: ws.getData() };
    super.catch(new WsException({ status: 'error', ...bodyOf(exception), cause }), host);
  }
}

function bodyOf(exception: HttpException | WsException): object {
  if (exception instanceof WsException) {
    const error = exception.getError();
    return typeof error === 'string' ? { message: error } : error;
  }
  // The services' exceptions, and the validation pipe's, which the client
  // would otherwise get as "Internal server error".
  const response = exception.getResponse();
  return typeof response === 'string' ? { statusCode: exception.getStatus(), message: response } : response;
}
