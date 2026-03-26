import { useState, useCallback } from 'react';
import { message } from 'antd';
import { api } from '../api/bridge';
import type { Person, CreatePersonDTO, UpdatePersonDTO } from '../types/person';

export function usePersonCRUD(onSuccess?: () => void) {
  const [loading, setLoading] = useState(false);

  const create = useCallback(
    async (data: CreatePersonDTO): Promise<Person | null> => {
      setLoading(true);
      try {
        const person = await api.person.create(data);
        message.success('添加成功');
        onSuccess?.();
        return person;
      } catch (err: any) {
        message.error(err?.message || '添加失败');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess],
  );

  const update = useCallback(
    async (id: string, data: UpdatePersonDTO): Promise<Person | null> => {
      setLoading(true);
      try {
        const person = await api.person.update(id, data);
        message.success('更新成功');
        onSuccess?.();
        return person;
      } catch (err: any) {
        message.error(err?.message || '更新失败');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      setLoading(true);
      try {
        await api.person.delete(id);
        message.success('删除成功');
        onSuccess?.();
        return true;
      } catch (err: any) {
        message.error(err?.message || '删除失败');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess],
  );

  return { create, update, remove, loading };
}
