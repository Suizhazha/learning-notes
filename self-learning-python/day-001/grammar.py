# 基础语法 grammar

# 变量赋值
name = "suizhazha" # 字符串
age = 18 # 整数
boolean = True # False
complex_number=1j # 复数
float_number=1.0 # 浮点数
none_value = None  # 相当于 JavaScript 的 null
list_data=[1,2,3] # 列表 (可变)
tuple_data=(1,2,3) # 元组 (不可变)
dictionary ={"name":"suizhazha","age":29} # 字典 (可变)
set_data = {1,2,3} # 集合 (可变)

# 解构赋值
first, second = 1, 2
obj = { "name": "suizhazha", "age": 29 }
name, age = obj.values()

print(name, age)

# 模版字符串 f-string
message = f"你好，{name}！你今年{age}岁。"
print(message)

# 类型检测
print(type(name)) # <class 'str'>
print(type(age)) # <class 'int'>
print(type(boolean)) # <class 'bool'>
print(type(complex_number)) # <class 'complex'>
print(type(float_number)) # <class 'float'>
print(type(none_value)) # <class 'NoneType'>
print(type(list_data)) # <class 'list'>
print(type(tuple_data)) # <class 'tuple'>
print(type(dictionary)) # <class 'dict'>
print(type(set_data)) # <class 'set'>
print(isinstance(name, str)) # True
print(isinstance(age, int)) # True
print(isinstance(boolean, bool)) # True
print(isinstance(complex_number, complex)) # True
print(isinstance(float_number, float)) # True
print(isinstance(list_data, list)) # True
print(isinstance(tuple_data, tuple)) # True
print(isinstance(dictionary, dict)) # True
print(isinstance(set_data, set)) # True

# Python 的设计者认为，绝大多数时候我们只需要判断 x is None，不需要频繁地获取 None 的类型，所以为了保持命名空间的整洁，没有把 NoneType 暴露出来。
# print(isinstance(none_value, NoneType)) # 报错
print(none_value is None) # True


# 全局作用域
global_var = "我是全局变量"

def test_scope():
    # 函数作用域
    function_var = "我是函数内变量"

    if True:
        # Python 没有块级作用域！
        block_var = "我是块级变量"
        print("块内访问:", block_var)
        print("块内访问函数变量:", function_var)
        print("块内访问全局变量:", global_var)

    # 块外仍然可以访问块级变量
    print("函数内访问块级变量:", block_var)
    print("函数内访问函数变量:", function_var)
    print("函数内访问全局变量:", global_var)

test_scope()
print("全局访问全局变量:", global_var)
# print(function_var)  # 错误！


# Python 全局变量修改
counter = 0

def increment():
    global counter  # 声明使用全局变量
    counter += 1
    print("计数器:", counter)

def increment_local():
    counter = 0  # 创建局部变量
    counter += 1
    print("局部计数器:", counter)

increment()
increment()
increment_local()
print("全局计数器:", counter)

# Python 闭包
def create_counter():
    count = 0

    def increment():
        nonlocal count  # 声明使用外层变量
        count += 1
        return count

    def get_count():
        return count

    return {
        'increment': increment,
        'get_count': get_count
    }

counter1 = create_counter()
counter2 = create_counter()

print(counter1['increment']())  # 1
print(counter1['increment']())  # 2
print(counter2['increment']())  # 1
print(counter1['get_count']())  # 2
print(counter2['get_count']())  # 1
