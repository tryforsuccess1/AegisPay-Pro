-- Keep exactly one Auth -> AegisPay profile trigger. Duplicate triggers caused the second trigger invocation to see the newly-created profile and raise the duplicate-email exception.
DROP TRIGGER IF EXISTS on_aegispay_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_aegispay_auth_user();
