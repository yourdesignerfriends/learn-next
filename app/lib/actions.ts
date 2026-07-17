'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import postgres from 'postgres';

// I keep the database connection at the top for clarity.
const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require' });

// ADD THESE IMPORTS FOR AUTH
import { signIn } from '@/auth';
import { AuthError } from 'next-auth';

// This is the state shape that useActionState expects.
// I include both field-level errors and a general message.
export type State = {
  errors?: {
    customerId?: string[];
    amount?: string[];
    status?: string[];
  };
  message?: string | null;
};

// I define the full schema once, then derive create/update schemas from it.
const FormSchema = z.object({
  id: z.string(),
  customerId: z.string().min(1, { message: 'Customer is required.' }),
  amount: z.coerce.number().positive({ message: 'Amount must be greater than 0.' }),
  status: z.enum(['pending', 'paid']),
  date: z.string(),
});

// I handle user authentication using NextAuth's signIn function.
// This action will be used by the login form with useActionState.
export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    // I attempt to sign in using the credentials provider.
    await signIn('credentials', formData);
  } catch (error) {
    // If NextAuth throws an AuthError, I return a friendly message.
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }

    // If it's not an AuthError, I rethrow it so the app can handle it.
    throw error;
  }
}

// For creating invoices, I omit id and date because they are generated.
const CreateInvoice = FormSchema.omit({ id: true, date: true });

// For updating invoices, I omit id and date as well.
const UpdateInvoice = FormSchema.omit({ id: true, date: true });

// This is the corrected createInvoice function.
// I changed the signature to accept prevState and formData,
// because useActionState calls the action with two arguments.
export async function createInvoice(prevState: State, formData: FormData) {
  // I validate the incoming fields using safeParse so it never throws.
  const validatedFields = CreateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });

  // If validation fails, I return structured errors for the form to display.
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Invoice.',
    };
  }

  // If validation succeeds, I extract the validated data.
  const { customerId, amount, status } = validatedFields.data;

  const amountInCents = amount * 100;
  const date = new Date().toISOString().split('T')[0];

  // I wrap the database insert in a try/catch so I can return a friendly error.
  try {
    await sql`
      INSERT INTO invoices (customer_id, amount, status, date)
      VALUES (${customerId}, ${amountInCents}, ${status}, ${date})
    `;
  } catch (error) {
    console.error(error);
    return {
      message: 'Database Error: Failed to Create Invoice.',
    };
  }

  // If everything succeeds, I revalidate and redirect.
  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

// I update the invoice using the same server-side validation pattern
// that I used in createInvoice. This ensures consistency across forms.
export async function updateInvoice(
  id: string,
  prevState: State,
  formData: FormData,
) {
  // I validate the incoming fields using safeParse so it never throws.
  const validatedFields = UpdateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });

  // If validation fails, I return structured errors and a general message.
  // useActionState will pass these back to the form component.
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Update Invoice.',
    };
  }

  // If validation succeeds, I extract the validated data.
  const { customerId, amount, status } = validatedFields.data;
  const amountInCents = amount * 100;

  // I wrap the database update in a try/catch so I can return
  // a friendly error message instead of crashing the app.
  try {
    await sql`
      UPDATE invoices
      SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
      WHERE id = ${id}
    `;
  } catch (error) {
    console.error(error);
    return { message: 'Database Error: Failed to Update Invoice.' };
  }

  // If everything succeeds, I revalidate the invoices page
  // and redirect the user back to the dashboard.
  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

// I keep deleteInvoice unchanged because it does not interact with forms.
export async function deleteInvoice(id: string) {
  try {
    await sql`DELETE FROM invoices WHERE id = ${id}`;
  } catch (error) {
    console.error(error);
    return { message: 'Database Error: Failed to Delete Invoice.' };
  }

  revalidatePath('/dashboard/invoices');
}