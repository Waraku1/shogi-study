/** A request's success is provisional: the transaction can still roll back. */
export function deleteStoredRecord(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite', {
      durability: 'strict',
    });
    let failure: DOMException | null = null;
    transaction.onabort = () =>
      reject(
        failure ??
          transaction.error ??
          new DOMException('Deletion aborted', 'AbortError'),
      );
    transaction.onerror = () => {
      failure ??=
        transaction.error ??
        new DOMException('Deletion failed', 'UnknownError');
    };
    transaction.oncomplete = () => (failure ? reject(failure) : resolve());
    const request = transaction.objectStore(store).delete(key);
    request.onerror = () => {
      failure = request.error;
    };
  });
}
